// hosterax/engine/src/org-manager.mjs
// Multi-Tenant Organizations, Workspaces & Role-Based Access Control (RBAC) Subsystem
// Supports workspace isolation, member invitations, and granular role permissions (Owner, Admin, Member, Viewer).

import crypto from "node:crypto";

export class OrgManager {
  constructor({ db }) {
    this.db = db;
    this.initSchema();
    this.ensureDefaultOrg();
  }

  initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS organizations (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        avatar_url TEXT,
        plan TEXT DEFAULT 'enterprise',
        is_default INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS organization_members (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL,
        user_email TEXT NOT NULL,
        user_name TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'member', -- 'owner', 'admin', 'member', 'viewer'
        joined_at INTEGER NOT NULL,
        FOREIGN KEY(org_id) REFERENCES organizations(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS organization_invites (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL,
        email TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'member',
        token TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'accepted', 'revoked'
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY(org_id) REFERENCES organizations(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_org_members_org ON organization_members(org_id);
    `);
  }

  ensureDefaultOrg() {
    const existing = this.db.prepare("SELECT * FROM organizations WHERE is_default=1").get();
    if (!existing) {
      const id = "org_default_workspace";
      const now = Date.now();
      this.db
        .prepare(
          `
        INSERT INTO organizations (id, name, slug, avatar_url, plan, is_default, created_at, updated_at)
        VALUES (?, 'Primary Workspace', 'primary', null, 'enterprise', 1, ?, ?)
      `,
        )
        .run(id, now, now);

      this.db
        .prepare(
          `
        INSERT INTO organization_members (id, org_id, user_email, user_name, role, joined_at)
        VALUES (?, ?, 'admin@hosterax.internal', 'System Admin', 'owner', ?)
      `,
        )
        .run(`mem_${crypto.randomBytes(6).toString("hex")}`, id, now);
    }
  }

  listOrganizations() {
    const orgs = this.db
      .prepare("SELECT * FROM organizations ORDER BY is_default DESC, created_at ASC")
      .all();
    return orgs.map((org) => {
      const memberCount =
        this.db
          .prepare("SELECT COUNT(*) as count FROM organization_members WHERE org_id=?")
          .get(org.id)?.count || 1;
      return { ...org, member_count: memberCount };
    });
  }

  getOrganization(idOrSlug) {
    const org = this.db
      .prepare("SELECT * FROM organizations WHERE id=? OR slug=?")
      .get(idOrSlug, idOrSlug);
    if (!org) return null;

    const members = this.db
      .prepare("SELECT * FROM organization_members WHERE org_id=? ORDER BY joined_at ASC")
      .all(org.id);
    const invites = this.db
      .prepare(
        "SELECT * FROM organization_invites WHERE org_id=? AND status='pending' ORDER BY created_at DESC",
      )
      .all(org.id);

    return { ...org, members, invites };
  }

  createOrganization({ name, slug, avatar_url = null }) {
    const cleanSlug = (slug || name)
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/-+/g, "-");
    const id = `org_${crypto.randomBytes(6).toString("hex")}`;
    const now = Date.now();

    this.db
      .prepare(
        `
      INSERT INTO organizations (id, name, slug, avatar_url, plan, is_default, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'enterprise', 0, ?, ?)
    `,
      )
      .run(id, name.trim(), cleanSlug, avatar_url, now, now);

    // Add creator as Owner
    this.db
      .prepare(
        `
      INSERT INTO organization_members (id, org_id, user_email, user_name, role, joined_at)
      VALUES (?, ?, 'admin@hosterax.internal', 'Workspace Owner', 'owner', ?)
    `,
      )
      .run(`mem_${crypto.randomBytes(6).toString("hex")}`, id, now);

    return this.getOrganization(id);
  }

  updateOrganization(id, updates) {
    const org = this.getOrganization(id);
    if (!org) throw new Error(`Organization "${id}" not found.`);

    const name = updates.name !== undefined ? updates.name.trim() : org.name;
    const avatar_url = updates.avatar_url !== undefined ? updates.avatar_url : org.avatar_url;
    const now = Date.now();

    this.db
      .prepare("UPDATE organizations SET name=?, avatar_url=?, updated_at=? WHERE id=?")
      .run(name, avatar_url, now, org.id);

    return this.getOrganization(org.id);
  }

  deleteOrganization(id) {
    const org = this.getOrganization(id);
    if (!org) throw new Error(`Organization "${id}" not found.`);
    if (org.is_default) throw new Error("Cannot delete primary default organization.");

    this.db.prepare("DELETE FROM organization_members WHERE org_id=?").run(org.id);
    this.db.prepare("DELETE FROM organization_invites WHERE org_id=?").run(org.id);
    const res = this.db.prepare("DELETE FROM organizations WHERE id=?").run(org.id);
    return res.changes > 0;
  }

  // ────────── Members & RBAC ──────────
  listMembers(orgId) {
    return this.db
      .prepare("SELECT * FROM organization_members WHERE org_id=? ORDER BY joined_at ASC")
      .all(orgId);
  }

  addMember(orgId, { user_email, user_name, role = "member" }) {
    const org = this.getOrganization(orgId);
    if (!org) throw new Error("Organization not found.");

    const existing = this.db
      .prepare("SELECT * FROM organization_members WHERE org_id=? AND user_email=?")
      .get(org.id, user_email.trim().toLowerCase());
    if (existing) throw new Error(`User with email "${user_email}" is already a member.`);

    const id = `mem_${crypto.randomBytes(6).toString("hex")}`;
    const now = Date.now();

    this.db
      .prepare(
        `
      INSERT INTO organization_members (id, org_id, user_email, user_name, role, joined_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        id,
        org.id,
        user_email.trim().toLowerCase(),
        (user_name || user_email.split("@")[0]).trim(),
        role,
        now,
      );

    return this.getOrganization(org.id);
  }

  updateMemberRole(orgId, memberId, role) {
    if (!["owner", "admin", "member", "viewer"].includes(role)) {
      throw new Error(`Invalid role "${role}". Allowed: owner, admin, member, viewer.`);
    }
    this.db
      .prepare("UPDATE organization_members SET role=? WHERE org_id=? AND id=?")
      .run(role, orgId, memberId);
    return this.getOrganization(orgId);
  }

  removeMember(orgId, memberId) {
    const mem = this.db
      .prepare("SELECT * FROM organization_members WHERE org_id=? AND id=?")
      .get(orgId, memberId);
    if (!mem) throw new Error("Member not found.");
    if (mem.role === "owner") {
      const ownerCount = this.db
        .prepare(
          "SELECT COUNT(*) as count FROM organization_members WHERE org_id=? AND role='owner'",
        )
        .get(orgId)?.count;
      if (ownerCount <= 1) throw new Error("Cannot remove the only organization owner.");
    }
    this.db
      .prepare("DELETE FROM organization_members WHERE org_id=? AND id=?")
      .run(orgId, memberId);
    return true;
  }

  // ────────── Invitations ──────────
  createInvite(orgId, { email, role = "member" }) {
    const id = `inv_${crypto.randomBytes(6).toString("hex")}`;
    const token = crypto.randomBytes(24).toString("hex");
    const now = Date.now();
    const expiresAt = now + 7 * 24 * 60 * 60 * 1000; // 7 days

    this.db
      .prepare(
        `
      INSERT INTO organization_invites (id, org_id, email, role, token, status, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)
    `,
      )
      .run(id, orgId, email.trim().toLowerCase(), role, token, expiresAt, now);

    return {
      id,
      org_id: orgId,
      email: email.trim().toLowerCase(),
      role,
      token,
      expires_at: expiresAt,
      invite_url: `http://localhost:8080/join?token=${token}`,
    };
  }

  revokeInvite(orgId, inviteId) {
    this.db
      .prepare("UPDATE organization_invites SET status='revoked' WHERE org_id=? AND id=?")
      .run(orgId, inviteId);
    return true;
  }
}
