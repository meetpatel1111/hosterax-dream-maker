import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  Users,
  Plus,
  Shield,
  Trash2,
  Mail,
  CheckCircle2,
  Copy,
  Check,
  Building,
  UserCheck,
  Zap,
  Globe,
  Radio,
  Lock,
} from "lucide-react";
import {
  useEngine,
  useOrganizations,
  useOrganization,
  type Organization,
  type OrganizationMember,
} from "@/lib/engine";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/team")({
  head: () => ({ meta: [{ title: "Team & RBAC — HosteraX" }] }),
  component: TeamPage,
});

function TeamPage() {
  const engine = useEngine();
  const { data: orgs = [], refetch: refetchOrgs } = useOrganizations();
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);

  const activeOrgSummary =
    orgs.find((o) => (selectedOrgId ? o.id === selectedOrgId : true)) || orgs[0];
  const { data: activeOrg, refetch: refetchActiveOrg } = useOrganization(activeOrgSummary?.id);

  // Modals
  const [createOrgOpen, setCreateOrgOpen] = useState(false);
  const [newOrgName, setNewOrgName] = useState("");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"owner" | "admin" | "member" | "viewer">("member");
  const [generatedInviteLink, setGeneratedInviteLink] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);

  async function handleCreateOrg() {
    if (!newOrgName.trim()) return;
    try {
      const created: any = await engine.call("POST", "/api/orgs", { name: newOrgName.trim() });
      toast.success(`Organization "${created.name}" created!`);
      setNewOrgName("");
      setCreateOrgOpen(false);
      refetchOrgs();
      setSelectedOrgId(created.id);
    } catch (e: any) {
      toast.error(e.message || "Failed to create organization");
    }
  }

  async function handleInviteMember() {
    if (!inviteEmail.trim() || !activeOrg) return;
    try {
      const inv: any = await engine.call("POST", `/api/orgs/${activeOrg.id}/invites`, {
        email: inviteEmail.trim(),
        role: inviteRole,
      });
      toast.success(`Invitation created for ${inviteEmail}!`);
      setGeneratedInviteLink(inv.invite_url);
      refetchActiveOrg();
      refetchOrgs();
    } catch (e: any) {
      toast.error(e.message || "Failed to create invitation");
    }
  }

  async function handleUpdateRole(memberId: string, role: string) {
    if (!activeOrg) return;
    try {
      await engine.call("PATCH", `/api/orgs/${activeOrg.id}/members/${memberId}`, { role });
      toast.success("Member role updated");
      refetchActiveOrg();
    } catch (e: any) {
      toast.error(e.message || "Failed to update role");
    }
  }

  async function handleRemoveMember(memberId: string, name: string) {
    if (!activeOrg) return;
    if (!confirm(`Are you sure you want to remove ${name} from this organization?`)) return;
    try {
      await engine.call("DELETE", `/api/orgs/${activeOrg.id}/members/${memberId}`);
      toast.success(`Member removed from ${activeOrg.name}`);
      refetchActiveOrg();
      refetchOrgs();
    } catch (e: any) {
      toast.error(e.message || "Failed to remove member");
    }
  }

  function handleCopyInvite() {
    if (!generatedInviteLink) return;
    navigator.clipboard.writeText(generatedInviteLink);
    setCopiedLink(true);
    toast.success("Invite link copied to clipboard!");
    setTimeout(() => setCopiedLink(false), 2000);
  }

  return (
    <div className="space-y-6 p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-border/50 pb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Badge
              variant="outline"
              className="bg-primary/10 text-primary border-primary/20 text-xs font-mono"
            >
              <Users className="w-3 h-3 mr-1" /> Multi-Tenant Workspaces
            </Badge>
            <span className="text-xs text-muted-foreground">Phase 3 Parity</span>
          </div>
          <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text">
            Teams & Role-Based Access Control
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Organize applications across isolated enterprise workspaces and enforce granular
            permissions (Owner, Admin, Member, Viewer).
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={() => setCreateOrgOpen(true)}>
            <Building className="w-4 h-4 mr-2" />
            New Organization
          </Button>
          <Button
            size="sm"
            className="bg-primary hover:bg-primary/90 text-primary-foreground shadow-sm"
            onClick={() => {
              setGeneratedInviteLink(null);
              setInviteOpen(true);
            }}
          >
            <Plus className="w-4 h-4 mr-2" />
            Invite Member
          </Button>
        </div>
      </div>

      {/* Workspace Switcher & Stats Card */}
      {activeOrg && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="rounded-xl border bg-card/60 p-4 shadow-sm space-y-2">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Active Organization
            </span>
            <div className="flex items-center justify-between">
              <div className="font-bold text-base text-foreground">{activeOrg.name}</div>
              <Badge variant="secondary" className="text-[10px] font-mono capitalize">
                {activeOrg.plan}
              </Badge>
            </div>
          </div>

          <div className="rounded-xl border bg-card/60 p-4 shadow-sm space-y-2">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Total Members
            </span>
            <div className="font-bold text-2xl font-mono text-foreground">
              {activeOrg.members?.length || 1}
            </div>
          </div>

          <div className="rounded-xl border bg-card/60 p-4 shadow-sm space-y-2">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Pending Invitations
            </span>
            <div className="font-bold text-2xl font-mono text-sky-400">
              {activeOrg.invites?.length || 0}
            </div>
          </div>

          <div className="rounded-xl border bg-card/60 p-4 shadow-sm space-y-2">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              RBAC Security Mode
            </span>
            <div className="font-bold text-sm text-emerald-400 flex items-center gap-1.5 pt-1">
              <Lock className="w-4 h-4" /> Granular Roles Active
            </div>
          </div>
        </div>
      )}

      {/* Members & Invitations Table */}
      <div className="rounded-xl border bg-card/60 shadow-sm overflow-hidden space-y-0">
        <div className="p-4 border-b border-border/40 flex items-center justify-between">
          <h3 className="text-base font-semibold">
            Team Members ({activeOrg?.members?.length || 0})
          </h3>
          {orgs.length > 1 && (
            <select
              value={activeOrg?.id}
              onChange={(e) => setSelectedOrgId(e.target.value)}
              className="h-8 rounded-md border border-input bg-background px-3 text-xs"
            >
              {orgs.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="divide-y divide-border/30">
          {activeOrg?.members?.map((member) => (
            <div
              key={member.id}
              className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-muted/20 transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary font-bold text-sm">
                  {member.user_name.slice(0, 2).toUpperCase()}
                </div>
                <div>
                  <div className="font-semibold text-sm text-foreground flex items-center gap-2">
                    {member.user_name}
                    {member.role === "owner" && (
                      <Badge
                        variant="outline"
                        className="text-[10px] bg-primary/10 text-primary border-primary/20"
                      >
                        Owner
                      </Badge>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground font-mono">{member.user_email}</div>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <select
                  value={member.role}
                  onChange={(e) => handleUpdateRole(member.id, e.target.value)}
                  disabled={member.role === "owner"}
                  className="h-8 rounded-md border border-input bg-background px-2.5 text-xs font-mono capitalize"
                >
                  <option value="owner">Owner</option>
                  <option value="admin">Admin</option>
                  <option value="member">Member</option>
                  <option value="viewer">Viewer</option>
                </select>

                {member.role !== "owner" && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                    onClick={() => handleRemoveMember(member.id, member.user_name)}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Pending Invites List */}
      {(activeOrg?.invites?.length ?? 0) > 0 && (
        <div className="rounded-xl border bg-card/60 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-border/40">
            <h3 className="text-sm font-semibold">
              Pending Invitations ({activeOrg?.invites?.length})
            </h3>
          </div>
          <div className="divide-y divide-border/30">
            {activeOrg?.invites?.map((inv) => (
              <div key={inv.id} className="p-3.5 flex items-center justify-between text-xs">
                <div>
                  <span className="font-medium">{inv.email}</span>
                  <span className="text-muted-foreground font-mono ml-2">Role: {inv.role}</span>
                </div>
                <Badge variant="outline" className="text-[10px]">
                  Expires in 7 days
                </Badge>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Create Org Modal */}
      <Dialog open={createOrgOpen} onOpenChange={setCreateOrgOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create New Organization</DialogTitle>
            <DialogDescription>
              Create an isolated organization workspace with dedicated projects and team members.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Label>Organization Name</Label>
            <Input
              placeholder="e.g. Acme Corp Infrastructure"
              value={newOrgName}
              onChange={(e) => setNewOrgName(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOrgOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateOrg}>Create Organization</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Invite Member Modal */}
      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Invite Team Member</DialogTitle>
            <DialogDescription>
              Invite a colleague to {activeOrg?.name} with specific RBAC permissions.
            </DialogDescription>
          </DialogHeader>

          {generatedInviteLink ? (
            <div className="space-y-3 py-2">
              <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-400 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                Invitation link generated! Share it with the invitee:
              </div>
              <div className="flex items-center gap-2">
                <Input readOnly value={generatedInviteLink} className="font-mono text-xs" />
                <Button size="sm" onClick={handleCopyInvite}>
                  {copiedLink ? (
                    <Check className="w-4 h-4 text-emerald-400" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3 py-2">
              <div className="space-y-1.5">
                <Label>Member Email</Label>
                <Input
                  type="email"
                  placeholder="developer@company.com"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Access Role</Label>
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as any)}
                  className="w-full h-9 rounded-md border border-input bg-background px-3 text-xs"
                >
                  <option value="admin">Admin (Full Control)</option>
                  <option value="member">Member (Deploy & Manage)</option>
                  <option value="viewer">Viewer (Read-Only Logs & Status)</option>
                </select>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setInviteOpen(false)}>
              Close
            </Button>
            {!generatedInviteLink && (
              <Button onClick={handleInviteMember}>Generate Invite Link</Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
