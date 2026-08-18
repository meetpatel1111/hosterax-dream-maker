// hosterax/engine/src/s3-storage.mjs
// S3-Compatible Multi-Cloud Storage Client for HosteraX
// Supports AWS S3, Cloudflare R2, MinIO, Wasabi, DigitalOcean Spaces, and custom endpoints.
// Implements AWS Signature Version 4 (HMAC-SHA256) natively with zero external dependencies.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import https from "node:https";

export class S3StorageClient {
  constructor(config = {}) {
    this.endpoint = (config.endpoint || "").trim(); // e.g. "https://<account>.r2.cloudflarestorage.com" or "https://s3.us-east-1.amazonaws.com"
    this.region = (config.region || "us-east-1").trim();
    this.bucket = (config.bucket || "").trim();
    this.accessKeyId = (config.accessKeyId || "").trim();
    this.secretAccessKey = (config.secretAccessKey || "").trim();
    this.prefix = (config.prefix || "hosterax-backups").replace(/^\/+|\/+$/g, "");
    this.forcePathStyle = Boolean(
      config.forcePathStyle ||
      config.endpoint?.includes("localhost") ||
      config.endpoint?.includes("127.0.0.1") ||
      config.endpoint?.includes("minio"),
    );
  }

  isConfigured() {
    return Boolean(this.bucket && this.accessKeyId && this.secretAccessKey);
  }

  /**
   * Helper to sign requests with AWS Signature Version 4
   */
  signV4({ method, urlPath, queryParams = {}, headers = {}, payload = Buffer.alloc(0) }) {
    const parsedUrl = new URL(this.endpoint || `https://s3.${this.region}.amazonaws.com`);
    const isHttps = parsedUrl.protocol === "https:";
    const host = parsedUrl.host;

    let fullPath = urlPath.startsWith("/") ? urlPath : `/${urlPath}`;
    if (this.forcePathStyle && this.bucket && !fullPath.startsWith(`/${this.bucket}`)) {
      fullPath = `/${this.bucket}${fullPath}`;
    }

    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, ""); // YYYYMMDDTHHmmssZ
    const dateStamp = amzDate.slice(0, 8); // YYYYMMDD

    const payloadHash = crypto.createHash("sha256").update(payload).digest("hex");

    const reqHeaders = {
      ...headers,
      host,
      "x-amz-date": amzDate,
      "x-amz-content-sha256": payloadHash,
    };

    // Canonical headers & signed headers
    const headerKeys = Object.keys(reqHeaders)
      .map((k) => k.toLowerCase())
      .sort();
    const canonicalHeaders = headerKeys.map((k) => `${k}:${reqHeaders[k].trim()}\n`).join("");
    const signedHeaders = headerKeys.join(";");

    // Canonical query string
    const canonicalQuery = Object.keys(queryParams)
      .sort()
      .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(queryParams[k])}`)
      .join("&");

    const canonicalRequest = [
      method.toUpperCase(),
      fullPath,
      canonicalQuery,
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join("\n");

    const credentialScope = `${dateStamp}/${this.region}/s3/aws4_request`;
    const stringToSign = [
      "AWS4-HMAC-SHA256",
      amzDate,
      credentialScope,
      crypto.createHash("sha256").update(canonicalRequest).digest("hex"),
    ].join("\n");

    // Signing Key Derivation
    const kDate = crypto
      .createHmac("sha256", `AWS4${this.secretAccessKey}`)
      .update(dateStamp)
      .digest();
    const kRegion = crypto.createHmac("sha256", kDate).update(this.region).digest();
    const kService = crypto.createHmac("sha256", kRegion).update("s3").digest();
    const kSigning = crypto.createHmac("sha256", kService).update("aws4_request").digest();

    const signature = crypto.createHmac("sha256", kSigning).update(stringToSign).digest("hex");

    const authorization = `AWS4-HMAC-SHA256 Credential=${this.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    reqHeaders.Authorization = authorization;

    return {
      protocol: parsedUrl.protocol,
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: canonicalQuery ? `${fullPath}?${canonicalQuery}` : fullPath,
      method: method.toUpperCase(),
      headers: reqHeaders,
    };
  }

  /**
   * Executes HTTP/HTTPS request to S3 endpoint
   */
  request({ method, urlPath, queryParams, headers = {}, payload = Buffer.alloc(0) }) {
    return new Promise((resolve, reject) => {
      const opts = this.signV4({ method, urlPath, queryParams, headers, payload });
      const client = opts.protocol === "https:" ? https : http;

      const req = client.request(opts, (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const body = Buffer.concat(chunks);
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body,
            bodyText: body.toString("utf8"),
          });
        });
      });

      req.on("error", (err) => reject(err));
      if (payload && payload.length > 0) {
        req.write(payload);
      }
      req.end();
    });
  }

  /**
   * Test bucket connectivity and permissions
   */
  async testConnection() {
    if (!this.isConfigured()) {
      return {
        ok: false,
        message:
          "S3 storage is not fully configured (bucket, accessKeyId, secretAccessKey required)",
      };
    }
    try {
      const res = await this.request({
        method: "GET",
        urlPath: this.forcePathStyle ? `/${this.bucket}` : "/",
        queryParams: { "list-type": "2", "max-keys": "1", prefix: this.prefix },
      });

      if (res.statusCode >= 200 && res.statusCode < 300) {
        return {
          ok: true,
          message: `Successfully connected to S3 bucket '${this.bucket}' (${this.region})`,
        };
      }
      if (res.statusCode === 403) {
        return {
          ok: false,
          message:
            "Authentication failed (403 Forbidden). Check Access Key and Secret Key permissions.",
        };
      }
      if (res.statusCode === 404) {
        return { ok: false, message: `Bucket '${this.bucket}' not found (404 Not Found).` };
      }
      return { ok: false, message: `S3 Error (${res.statusCode}): ${res.bodyText.slice(0, 300)}` };
    } catch (err) {
      return { ok: false, message: `Connection error: ${err.message}` };
    }
  }

  /**
   * Upload a local backup file to S3 bucket
   */
  async uploadBackupFile(localFilePath, s3KeyName = null) {
    if (!this.isConfigured()) {
      throw new Error("S3 storage is not configured");
    }
    if (!fs.existsSync(localFilePath)) {
      throw new Error(`Local file not found: ${localFilePath}`);
    }

    const filename = path.basename(localFilePath);
    const key = s3KeyName || `${this.prefix}/${filename}`;
    const fileBuffer = fs.readFileSync(localFilePath);
    const stat = fs.statSync(localFilePath);

    const headers = {
      "Content-Type": "application/gzip",
      "Content-Length": String(stat.size),
    };

    const targetPath = this.forcePathStyle ? `/${this.bucket}/${key}` : `/${key}`;

    const res = await this.request({
      method: "PUT",
      urlPath: targetPath,
      headers,
      payload: fileBuffer,
    });

    if (res.statusCode >= 200 && res.statusCode < 300) {
      return {
        ok: true,
        key,
        sizeBytes: stat.size,
        etag: res.headers.etag || "",
        uploadedAt: Date.now(),
        location: `${this.endpoint}/${this.bucket}/${key}`,
      };
    }

    throw new Error(`S3 upload failed (${res.statusCode}): ${res.bodyText.slice(0, 300)}`);
  }

  /**
   * List backups stored in the remote S3 bucket
   */
  async listRemoteBackups() {
    if (!this.isConfigured()) return [];

    try {
      const res = await this.request({
        method: "GET",
        urlPath: this.forcePathStyle ? `/${this.bucket}` : "/",
        queryParams: { "list-type": "2", prefix: this.prefix, "max-keys": "100" },
      });

      if (res.statusCode < 200 || res.statusCode >= 300) {
        return [];
      }

      const xml = res.bodyText;
      const items = [];
      const contentBlocks = xml.split("<Contents>");

      for (let i = 1; i < contentBlocks.length; i++) {
        const block = contentBlocks[i];
        const keyMatch = block.match(/<Key>(.*?)<\/Key>/);
        const sizeMatch = block.match(/<Size>(\d+)<\/Size>/);
        const dateMatch = block.match(/<LastModified>(.*?)<\/LastModified>/);
        const etagMatch = block.match(/<ETag>(.*?)<\/ETag>/);

        if (keyMatch) {
          items.push({
            key: keyMatch[1],
            filename: path.basename(keyMatch[1]),
            sizeBytes: sizeMatch ? Number(sizeMatch[1]) : 0,
            lastModified: dateMatch ? new Date(dateMatch[1]).getTime() : Date.now(),
            etag: etagMatch ? etagMatch[1].replace(/"/g, "") : "",
          });
        }
      }

      return items.sort((a, b) => b.lastModified - a.lastModified);
    } catch {
      return [];
    }
  }

  /**
   * Delete an object from S3 bucket
   */
  async deleteRemoteBackup(s3Key) {
    if (!this.isConfigured()) return false;
    const targetPath = this.forcePathStyle ? `/${this.bucket}/${s3Key}` : `/${s3Key}`;
    const res = await this.request({
      method: "DELETE",
      urlPath: targetPath,
    });
    return res.statusCode >= 200 && res.statusCode < 300;
  }
}
