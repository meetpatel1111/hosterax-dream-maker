// Minimal in-browser ustar + gzip writer so a dropped folder can be uploaded as one archive.
// Uses only the standard CompressionStream API (no dependencies).

const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  ".turbo",
  ".cache",
  "dist",
  "target",
]);

const enc = new TextEncoder();

function octal(value: number, length: number): string {
  return value.toString(8).padStart(length - 1, "0") + "\0";
}

function header(path: string, size: number, mtime: number): Uint8Array<ArrayBuffer> {
  const h = new Uint8Array(512);
  const put = (str: string, offset: number, max: number) =>
    h.set(enc.encode(str).subarray(0, max), offset);

  // ustar splits long names into prefix (155) + name (100)
  let name = path;
  let prefix = "";
  if (enc.encode(path).length > 100) {
    const cut = path.lastIndexOf("/", 155);
    if (cut > 0 && enc.encode(path.slice(cut + 1)).length <= 100) {
      prefix = path.slice(0, cut);
      name = path.slice(cut + 1);
    } else {
      throw new Error(`Path too long for tar: ${path}`);
    }
  }
  put(name, 0, 100);
  put(octal(0o644, 8), 100, 8); // mode
  put(octal(0, 8), 108, 8); // uid
  put(octal(0, 8), 116, 8); // gid
  put(octal(size, 12), 124, 12);
  put(octal(mtime, 12), 136, 12);
  h.fill(0x20, 148, 156); // checksum placeholder (spaces)
  h[156] = "0".charCodeAt(0); // regular file
  put("ustar\0", 257, 6);
  put("00", 263, 2);
  put(prefix, 345, 155);

  let sum = 0;
  for (const b of h) sum += b;
  put(sum.toString(8).padStart(6, "0") + "\0 ", 148, 8);
  return h;
}

export type TarResult = { blob: Blob; files: number; skipped: number; bytes: number };

/** Builds a .tar.gz from a folder selection (File objects carrying webkitRelativePath). */
export async function createTarGz(files: File[]): Promise<TarResult> {
  const parts: BlobPart[] = [];
  let count = 0;
  let skipped = 0;
  let bytes = 0;

  for (const f of files) {
    const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
    const segments = rel.split("/");
    // drop the top-level folder name's ignored children (node_modules, .git, build output …)
    if (segments.slice(1, -1).some((s) => IGNORED_DIRS.has(s))) {
      skipped++;
      continue;
    }
    parts.push(header(rel, f.size, Math.floor(f.lastModified / 1000)));
    parts.push(f);
    const pad = (512 - (f.size % 512)) % 512;
    if (pad) parts.push(new Uint8Array(pad));
    count++;
    bytes += f.size;
  }
  parts.push(new Uint8Array(1024)); // end-of-archive marker

  const gz = new Blob(parts).stream().pipeThrough(new CompressionStream("gzip"));
  const blob = await new Response(gz).blob();
  return { blob, files: count, skipped, bytes };
}
