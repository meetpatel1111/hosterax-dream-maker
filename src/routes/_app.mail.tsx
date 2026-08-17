import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  Mail,
  Plus,
  Send,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Inbox,
  Shield,
  Star,
  RefreshCw,
  Copy,
  Check,
  HardDrive,
  Users,
  Key,
  Globe,
  Loader2,
  FileText,
} from "lucide-react";
import {
  useEngine,
  useEmailDomains,
  useMailboxes,
  useEmailMessages,
  type EmailDomain,
  type Mailbox,
  type EmailMessage,
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

export const Route = createFileRoute("/_app/mail")({
  head: () => ({ meta: [{ title: "Mailboxes — HosteraX" }] }),
  component: MailboxesPage,
});

function MailboxesPage() {
  const engine = useEngine();
  const { data: domains = [], refetch: refetchDomains, isLoading: loadingDomains } = useEmailDomains();
  const [selectedDomainId, setSelectedDomainId] = useState<string | null>(null);

  const activeDomain = domains.find((d) => (selectedDomainId ? d.id === selectedDomainId : true)) || domains[0];
  const { data: mailboxes = [], refetch: refetchMailboxes } = useMailboxes(activeDomain?.id);
  const [selectedMailboxId, setSelectedMailboxId] = useState<string | null>(null);

  const activeMailbox = mailboxes.find((m) => (selectedMailboxId ? m.id === selectedMailboxId : true)) || mailboxes[0];
  const [folder, setFolder] = useState<"inbox" | "sent" | "trash">("inbox");
  const { data: messages = [], refetch: refetchMessages } = useEmailMessages(activeMailbox?.id, folder);

  const [selectedMessage, setSelectedMessage] = useState<EmailMessage | null>(null);

  // Modals
  const [addDomainOpen, setAddDomainOpen] = useState(false);
  const [newDomainName, setNewDomainName] = useState("");
  const [addMailboxOpen, setAddMailboxOpen] = useState(false);
  const [newMailboxEmail, setNewMailboxEmail] = useState("");
  const [newMailboxName, setNewMailboxName] = useState("");
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeTo, setComposeTo] = useState("");
  const [composeSubject, setComposeSubject] = useState("");
  const [composeBody, setComposeBody] = useState("");
  const [sending, setSending] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const [verifyingDns, setVerifyingDns] = useState(false);

  async function handleAddDomain() {
    if (!newDomainName.trim()) return;
    try {
      await engine.call("POST", "/api/email/domains", { domain: newDomainName.trim() });
      toast.success(`Domain "${newDomainName}" registered for email hosting!`);
      setNewDomainName("");
      setAddDomainOpen(false);
      refetchDomains();
    } catch (e: any) {
      toast.error(e.message || "Failed to add email domain");
    }
  }

  async function handleVerifyLiveDns() {
    if (!activeDomain) return;
    setVerifyingDns(true);
    try {
      const res: any = await engine.call("POST", `/api/email/domains/${activeDomain.id}/verify-dns`);
      toast.success(`Live DNS verified! SPF: ${res.spf_status}, DKIM: ${res.dkim_status}, DMARC: ${res.dmarc_status}, MX: ${res.mx_status}`);
      refetchDomains();
    } catch (e: any) {
      toast.error(e.message || "Failed to verify live DNS");
    } finally {
      setVerifyingDns(false);
    }
  }

  async function handleCreateMailbox() {
    if (!newMailboxEmail.trim() || !activeDomain) return;
    try {
      const fullEmail = newMailboxEmail.includes("@")
        ? newMailboxEmail.trim()
        : `${newMailboxEmail.trim()}@${activeDomain.domain}`;
      await engine.call("POST", "/api/email/mailboxes", {
        domain_id: activeDomain.id,
        email: fullEmail,
        name: newMailboxName.trim() || newMailboxEmail.trim(),
      });
      toast.success(`Mailbox "${fullEmail}" created!`);
      setNewMailboxEmail("");
      setNewMailboxName("");
      setAddMailboxOpen(false);
      refetchMailboxes();
      refetchDomains();
    } catch (e: any) {
      toast.error(e.message || "Failed to create mailbox");
    }
  }

  async function handleSendMessage() {
    if (!activeMailbox || !composeTo.trim() || !composeSubject.trim()) return;
    setSending(true);
    try {
      await engine.call("POST", "/api/email/send", {
        mailbox_id: activeMailbox.id,
        to: composeTo.trim(),
        subject: composeSubject.trim(),
        body_text: composeBody,
      });
      toast.success("Email sent successfully!");
      setComposeTo("");
      setComposeSubject("");
      setComposeBody("");
      setComposeOpen(false);
      refetchMessages();
    } catch (e: any) {
      toast.error(e.message || "Failed to send email");
    } finally {
      setSending(false);
    }
  }

  function handleCopy(text: string, id: string) {
    navigator.clipboard.writeText(text);
    setCopiedKey(id);
    toast.success("DNS record copied to clipboard!");
    setTimeout(() => setCopiedKey(null), 2000);
  }

  return (
    <div className="space-y-6 p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-border/50 pb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20 text-xs font-mono">
              <Mail className="w-3 h-3 mr-1" /> Self-Hosted Email Stack
            </Badge>
            <span className="text-xs text-muted-foreground">Phase 3 Parity</span>
          </div>
          <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text">
            Mailboxes & Webmail
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Self-host your custom domain email infrastructure with automated SPF, DKIM, DMARC DNS calculation and integrated webmail.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={() => setAddDomainOpen(true)}>
            <Globe className="w-4 h-4 mr-2" />
            Add Email Domain
          </Button>
          <Button size="sm" className="bg-primary hover:bg-primary/90 text-primary-foreground shadow-sm" onClick={() => setComposeOpen(true)}>
            <Send className="w-4 h-4 mr-2" />
            Compose Email
          </Button>
        </div>
      </div>

      {/* Domain DNS Health Card */}
      {activeDomain && (
        <div className="rounded-xl border bg-card/60 p-5 shadow-sm space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Shield className="h-5 w-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-base">{activeDomain.domain}</span>
                  <Badge variant="secondary" className="text-[10px] py-0 px-2 font-mono">
                    {activeDomain.mailbox_count || 0} Mailboxes
                  </Badge>
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  Automated DNS Records & Anti-Spam Security Enforcement
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-9 text-xs"
                disabled={verifyingDns}
                onClick={handleVerifyLiveDns}
              >
                <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${verifyingDns ? "animate-spin" : ""}`} />
                {verifyingDns ? "Resolving DNS..." : "Verify Live DNS"}
              </Button>
              {domains.length > 1 && (
                <select
                  value={activeDomain.id}
                  onChange={(e) => setSelectedDomainId(e.target.value)}
                  className="h-9 rounded-md border border-input bg-background px-3 text-xs"
                >
                  {domains.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.domain}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>

          {/* DNS Records Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 pt-2">
            {activeDomain.dns_records?.map((record, i) => (
              <div key={i} className="rounded-lg border bg-muted/20 p-3 space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-mono font-bold text-primary">{record.type} Record</span>
                  {record.status === "verified" ? (
                    <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400 font-medium bg-emerald-500/10 px-1.5 py-0.5 rounded">
                      <CheckCircle2 className="w-2.5 h-2.5" /> Valid
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[10px] text-amber-400 font-medium bg-amber-500/10 px-1.5 py-0.5 rounded">
                      <AlertCircle className="w-2.5 h-2.5" /> {record.status}
                    </span>
                  )}
                </div>
                <div className="text-muted-foreground text-[11px]">{record.purpose}</div>
                <div className="flex items-center justify-between bg-background/60 p-1.5 rounded font-mono text-[11px] overflow-hidden">
                  <span className="truncate mr-2">{record.value}</span>
                  <button
                    onClick={() => handleCopy(record.value, `dns_${i}`)}
                    className="text-muted-foreground hover:text-foreground shrink-0"
                  >
                    {copiedKey === `dns_${i}` ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Webmail Split Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Sidebar: Mailboxes & Folders */}
        <div className="lg:col-span-3 rounded-xl border bg-card/60 p-4 shadow-sm space-y-5">
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Mailboxes</span>
              <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setAddMailboxOpen(true)}>
                <Plus className="w-3.5 h-3.5" />
              </Button>
            </div>

            <div className="space-y-1">
              {mailboxes.map((mbox) => (
                <button
                  key={mbox.id}
                  onClick={() => {
                    setSelectedMailboxId(mbox.id);
                    setSelectedMessage(null);
                  }}
                  className={`w-full text-left p-2.5 rounded-lg text-xs transition-colors flex items-center justify-between ${
                    activeMailbox?.id === mbox.id ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted/40 text-foreground"
                  }`}
                >
                  <div className="truncate">
                    <div className="font-semibold truncate">{mbox.name}</div>
                    <div className="text-[11px] text-muted-foreground truncate">{mbox.email}</div>
                  </div>
                  <Badge variant="outline" className="text-[10px] font-mono shrink-0 ml-1">
                    {mbox.used_mb}MB
                  </Badge>
                </button>
              ))}
            </div>
          </div>

          <div className="pt-3 border-t border-border/40 space-y-1">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground block mb-2">Folders</span>
            <button
              onClick={() => {
                setFolder("inbox");
                setSelectedMessage(null);
              }}
              className={`w-full text-left p-2 rounded-lg text-xs flex items-center justify-between ${
                folder === "inbox" ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted/40 text-muted-foreground"
              }`}
            >
              <span className="flex items-center gap-2">
                <Inbox className="w-4 h-4" /> Inbox
              </span>
              <span className="font-mono text-[10px]">{folder === "inbox" ? messages.length : ""}</span>
            </button>
            <button
              onClick={() => {
                setFolder("sent");
                setSelectedMessage(null);
              }}
              className={`w-full text-left p-2 rounded-lg text-xs flex items-center justify-between ${
                folder === "sent" ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted/40 text-muted-foreground"
              }`}
            >
              <span className="flex items-center gap-2">
                <Send className="w-4 h-4" /> Sent
              </span>
              <span className="font-mono text-[10px]">{folder === "sent" ? messages.length : ""}</span>
            </button>
          </div>
        </div>

        {/* Middle: Message List */}
        <div className="lg:col-span-4 rounded-xl border bg-card/60 shadow-sm overflow-hidden min-h-[420px]">
          <div className="p-3.5 border-b border-border/40 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground capitalize">
              {folder} ({messages.length})
            </span>
            <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => refetchMessages()}>
              <RefreshCw className="w-3.5 h-3.5" />
            </Button>
          </div>

          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-12 text-center text-muted-foreground">
              <Inbox className="w-8 h-8 opacity-20 mb-2" />
              <p className="text-xs">No emails in {folder}</p>
            </div>
          ) : (
            <div className="divide-y divide-border/30 max-h-[500px] overflow-y-auto">
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  onClick={() => setSelectedMessage(msg)}
                  className={`p-3 text-xs cursor-pointer transition-colors ${
                    selectedMessage?.id === msg.id ? "bg-primary/10" : msg.is_read ? "hover:bg-muted/30 opacity-75" : "hover:bg-muted/30 font-medium"
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-semibold truncate text-foreground">{folder === "sent" ? msg.to_address : msg.from_address}</span>
                    <span className="text-[10px] text-muted-foreground font-mono">
                      {new Date(msg.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                  <div className="text-foreground truncate font-medium">{msg.subject}</div>
                  <div className="text-muted-foreground text-[11px] truncate mt-0.5">{msg.body_text}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right: Message Detail Viewer */}
        <div className="lg:col-span-5 rounded-xl border bg-card/60 p-5 shadow-sm min-h-[420px] flex flex-col justify-between">
          {selectedMessage ? (
            <div className="space-y-4">
              <div className="border-b border-border/40 pb-3">
                <h3 className="text-base font-bold text-foreground">{selectedMessage.subject}</h3>
                <div className="text-xs text-muted-foreground mt-1 space-y-0.5 font-mono">
                  <div>From: {selectedMessage.from_address}</div>
                  <div>To: {selectedMessage.to_address}</div>
                  <div>Date: {new Date(selectedMessage.created_at).toLocaleString()}</div>
                </div>
              </div>

              <div className="text-xs text-foreground leading-relaxed whitespace-pre-wrap">
                {selectedMessage.body_text}
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center p-16 text-center text-muted-foreground my-auto">
              <FileText className="w-8 h-8 opacity-20 mb-2" />
              <p className="text-xs">Select an email to read its contents</p>
            </div>
          )}
        </div>
      </div>

      {/* Add Domain Modal */}
      <Dialog open={addDomainOpen} onOpenChange={setAddDomainOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add Email Domain</DialogTitle>
            <DialogDescription>
              Register a domain to provision self-hosted mailboxes and calculate DNS anti-spam records.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Label>Domain Name</Label>
            <Input
              placeholder="e.g. mycompany.com"
              value={newDomainName}
              onChange={(e) => setNewDomainName(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddDomainOpen(false)}>Cancel</Button>
            <Button onClick={handleAddDomain}>Add Domain</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Mailbox Modal */}
      <Dialog open={addMailboxOpen} onOpenChange={setAddMailboxOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create Mailbox</DialogTitle>
            <DialogDescription>
              Provision a new email address on {activeDomain?.domain}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label>Email Username / Prefix</Label>
              <div className="flex items-center gap-2">
                <Input
                  placeholder="contact"
                  value={newMailboxEmail}
                  onChange={(e) => setNewMailboxEmail(e.target.value)}
                />
                <span className="font-mono text-xs text-muted-foreground">@{activeDomain?.domain}</span>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Display Name</Label>
              <Input
                placeholder="Contact Support"
                value={newMailboxName}
                onChange={(e) => setNewMailboxName(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddMailboxOpen(false)}>Cancel</Button>
            <Button onClick={handleCreateMailbox}>Create Mailbox</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Compose Email Modal */}
      <Dialog open={composeOpen} onOpenChange={setComposeOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Compose Email</DialogTitle>
            <DialogDescription>
              Send an email from {activeMailbox?.email || "your mailbox"}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2 text-xs">
            <div className="space-y-1">
              <Label>Recipient (To:)</Label>
              <Input
                placeholder="user@example.com"
                value={composeTo}
                onChange={(e) => setComposeTo(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>Subject</Label>
              <Input
                placeholder="Infrastructure Status Update"
                value={composeSubject}
                onChange={(e) => setComposeSubject(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>Message Body</Label>
              <textarea
                className="w-full h-32 rounded-md border border-input bg-background p-3 text-xs outline-none focus:border-primary font-sans"
                placeholder="Type your message here..."
                value={composeBody}
                onChange={(e) => setComposeBody(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setComposeOpen(false)}>Cancel</Button>
            <Button onClick={handleSendMessage} disabled={sending}>
              {sending ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Send className="w-3.5 h-3.5 mr-1" />}
              {sending ? "Sending..." : "Send Email"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
