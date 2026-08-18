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
  Forward,
  Server,
  Zap,
  Radio,
  ExternalLink,
  Eye,
  Edit3,
  Sparkles,
  Archive,
  ArrowRight,
} from "lucide-react";
import {
  useEngine,
  useEmailDomains,
  useMailboxes,
  useEmailMessages,
  useEmailAliases,
  useEmailSmtpRelays,
  type EmailDomain,
  type Mailbox,
  type EmailMessage,
  type EmailAlias,
  type EmailSmtpRelay,
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
  head: () => ({ meta: [{ title: "Mailboxes & Email Stack — HosteraX" }] }),
  component: MailboxesPage,
});

const EMAIL_TEMPLATES = [
  {
    id: "welcome",
    name: "🚀 Welcome & Activation",
    subject: "Welcome to your new cloud workspace on HosteraX",
    body: `Hi there,\n\nWelcome to HosteraX! Your account and project environments have been successfully provisioned.\n\nYou can now deploy containers, databases, cron jobs, and background workers directly from your control plane.\n\nBest regards,\nThe HosteraX Infrastructure Team`,
  },
  {
    id: "password_reset",
    name: "🔐 Password Reset OTP",
    subject: "Security Notification: Password Reset Request",
    body: `Hello,\n\nA password reset request was initiated for your administrator account.\n\nUse the following one-time verification code to proceed:\n\n👉 SEC-849204\n\nThis verification code expires in 15 minutes. If you did not request this, please review your server security logs immediately.`,
  },
  {
    id: "incident_alert",
    name: "🚨 Server Crash / AutoHeal Alert",
    subject: "[INCIDENT ALERT] Service Container Flapping Detected",
    body: `CRITICAL ALERT:\n\nService: it-tools-app\nHost: node-primary (127.0.0.1:3000)\nEvent: AutoHeal Circuit Breaker Tripped to OPEN state\nRoot Cause: Consecutive connection timeouts on port 3000.\n\nRemediation: Autonomous Self-Healing Engine has isolated the container. Automatic canary probes will commence in 30s.`,
  },
  {
    id: "invoice",
    name: "🧾 Monthly Cloud Invoice",
    subject: "Invoice #HX-2026-0818 for Cloud Services",
    body: `Dear Customer,\n\nThank you for choosing HosteraX. Your monthly infrastructure statement is ready.\n\nPlan: Developer Free Tier\nTotal Amount Due: $0.00\nBilling Cycle: August 2026\nStatus: Paid / In Good Standing.\n\nView details inside your HosteraX Dashboard.`,
  },
];

const PRESET_RELAYS = [
  {
    provider: "resend" as const,
    name: "Resend",
    host: "smtp.resend.com",
    port: 587,
    username: "resend",
    help: "Free 3,000 emails/mo. Password is your Resend API Key (re_...).",
    url: "https://resend.com/api-keys",
  },
  {
    provider: "custom" as const,
    name: "Gmail SMTP (Free 500/day)",
    host: "smtp.gmail.com",
    port: 587,
    username: "your-email@gmail.com",
    help: "Free 15,000 emails/mo. Password is a 16-character Google App Password.",
    url: "https://myaccount.google.com/apppasswords",
  },
  {
    provider: "custom" as const,
    name: "Brevo / Sendinblue (Free 300/day)",
    host: "smtp-relay.brevo.com",
    port: 587,
    username: "your-login",
    help: "Free 9,000 emails/mo. Password is your Brevo SMTP key.",
    url: "https://app.brevo.com/settings/keys/smtp",
  },
  {
    provider: "ses" as const,
    name: "Amazon SES",
    host: "email-smtp.us-east-1.amazonaws.com",
    port: 587,
    username: "AKIA...",
    help: "Free 62,000 emails/mo ($0.10 per 1k thereafter). High scale.",
    url: "https://aws.amazon.com/ses/",
  },
  {
    provider: "postmark" as const,
    name: "Postmark",
    host: "smtp.postmarkapp.com",
    port: 587,
    username: "postmark-token",
    help: "Pristine IP reputation and fast transactional inbox delivery.",
    url: "https://postmarkapp.com/",
  },
];

function MailboxesPage() {
  const engine = useEngine();
  const [activeTab, setActiveTab] = useState<"webmail" | "aliases" | "relays">("webmail");

  const { data: domains = [], refetch: refetchDomains } = useEmailDomains();
  const [selectedDomainId, setSelectedDomainId] = useState<string | null>(null);

  const activeDomain =
    domains.find((d) => (selectedDomainId ? d.id === selectedDomainId : true)) || domains[0];
  const { data: mailboxes = [], refetch: refetchMailboxes } = useMailboxes(activeDomain?.id);
  const [selectedMailboxId, setSelectedMailboxId] = useState<string | null>(null);

  const activeMailbox =
    mailboxes.find((m) => (selectedMailboxId ? m.id === selectedMailboxId : true)) || mailboxes[0];
  const [folder, setFolder] = useState<"inbox" | "sent" | "trash">("inbox");
  const { data: messages = [], refetch: refetchMessages } = useEmailMessages(
    activeMailbox?.id,
    folder,
  );
  const [selectedMessage, setSelectedMessage] = useState<EmailMessage | null>(null);

  const { data: aliases = [], refetch: refetchAliases } = useEmailAliases(activeDomain?.id);
  const { data: relays = [], refetch: refetchRelays } = useEmailSmtpRelays();

  // Modals & Forms
  const [addDomainOpen, setAddDomainOpen] = useState(false);
  const [newDomainName, setNewDomainName] = useState("");
  const [addMailboxOpen, setAddMailboxOpen] = useState(false);
  const [newMailboxEmail, setNewMailboxEmail] = useState("");
  const [newMailboxName, setNewMailboxName] = useState("");
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeTo, setComposeTo] = useState("");
  const [composeSubject, setComposeSubject] = useState("");
  const [composeBody, setComposeBody] = useState("");
  const [composeMode, setComposeMode] = useState<"edit" | "preview">("edit");
  const [sending, setSending] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [verifyingDns, setVerifyingDns] = useState(false);

  // Alias modal & Webhook test
  const [addAliasOpen, setAddAliasOpen] = useState(false);
  const [newAliasSource, setNewAliasSource] = useState("");
  const [newAliasType, setNewAliasType] = useState<"email" | "webhook">("email");
  const [newAliasTarget, setNewAliasTarget] = useState("");
  const [testingAliasId, setTestingAliasId] = useState<string | null>(null);
  const [aliasTestResult, setAliasTestResult] = useState<Record<string, any>>({});

  // Relay modal
  const [addRelayOpen, setAddRelayOpen] = useState(false);
  const [relayName, setRelayName] = useState("");
  const [relayProvider, setRelayProvider] = useState<
    "direct" | "resend" | "postmark" | "ses" | "sendgrid" | "custom"
  >("resend");
  const [relayHost, setRelayHost] = useState("smtp.resend.com");
  const [relayPort, setRelayPort] = useState(587);
  const [relayUsername, setRelayUsername] = useState("resend");
  const [relayPassword, setRelayPassword] = useState("");
  const [relayFromEmail, setRelayFromEmail] = useState("");
  const [testingRelayId, setTestingRelayId] = useState<string | null>(null);

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
      const res: any = await engine.call(
        "POST",
        `/api/email/domains/${activeDomain.id}/verify-dns`,
      );
      toast.success(
        `Live DNS verified! SPF: ${res.spf_status}, DKIM: ${res.dkim_status}, DMARC: ${res.dmarc_status}, MX: ${res.mx_status}`,
      );
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

  async function handleCreateAlias() {
    if (!newAliasSource.trim() || !newAliasTarget.trim() || !activeDomain) return;
    try {
      const fullSource = newAliasSource.includes("@")
        ? newAliasSource.trim()
        : `${newAliasSource.trim()}@${activeDomain.domain}`;
      await engine.call("POST", "/api/email/aliases", {
        domain_id: activeDomain.id,
        source_email: fullSource,
        destination_type: newAliasType,
        destination_target: newAliasTarget.trim(),
      });
      toast.success(`Alias "${fullSource}" created!`);
      setNewAliasSource("");
      setNewAliasTarget("");
      setAddAliasOpen(false);
      refetchAliases();
      refetchDomains();
    } catch (e: any) {
      toast.error(e.message || "Failed to create alias");
    }
  }

  async function handleTestWebhook(aliasId: string) {
    setTestingAliasId(aliasId);
    try {
      const res: any = await engine.call("POST", `/api/email/aliases/${aliasId}/test`);
      setAliasTestResult((prev) => ({ ...prev, [aliasId]: res }));
      if (res.ok) {
        toast.success(
          `Webhook test passed (${res.status} ${res.statusText || "OK"} in ${res.latency_ms}ms)`,
        );
      } else {
        toast.error(`Webhook test failed: ${res.error || `HTTP ${res.status}`}`);
      }
    } catch (e: any) {
      toast.error(e.message || "Webhook test error");
    } finally {
      setTestingAliasId(null);
    }
  }

  async function handleDeleteAlias(id: string) {
    try {
      await engine.call("DELETE", `/api/email/aliases/${id}`);
      toast.success("Alias deleted");
      refetchAliases();
      refetchDomains();
    } catch (e: any) {
      toast.error(e.message || "Failed to delete alias");
    }
  }

  async function handleSaveRelay() {
    if (!relayName.trim() || !relayHost.trim()) return;
    try {
      await engine.call("POST", "/api/email/smtp-relays", {
        name: relayName.trim(),
        provider: relayProvider,
        host: relayHost.trim(),
        port: Number(relayPort),
        username: relayUsername.trim(),
        password: relayPassword,
        from_email: relayFromEmail.trim(),
        is_default: 1,
      });
      toast.success(`SMTP Relay "${relayName}" configured!`);
      setAddRelayOpen(false);
      refetchRelays();
    } catch (e: any) {
      toast.error(e.message || "Failed to save SMTP relay");
    }
  }

  async function handleTestRelay(relay: EmailSmtpRelay) {
    setTestingRelayId(relay.id);
    try {
      const res: any = await engine.call("POST", "/api/email/smtp-relays/test", relay);
      if (res.ok) {
        toast.success(res.message || "SMTP connection verified!");
      } else {
        toast.error(res.error || "Connection failed");
      }
    } catch (e: any) {
      toast.error(e.message || "Test error");
    } finally {
      setTestingRelayId(null);
    }
  }

  async function handleDeleteRelay(id: string) {
    try {
      await engine.call("DELETE", `/api/email/smtp-relays/${id}`);
      toast.success("SMTP relay deleted");
      refetchRelays();
    } catch (e: any) {
      toast.error(e.message || "Failed to delete relay");
    }
  }

  async function handleSendMessage() {
    if (!activeMailbox || !composeTo.trim() || !composeSubject.trim()) return;
    setSending(true);
    try {
      const res: any = await engine.call("POST", "/api/email/send", {
        mailbox_id: activeMailbox.id,
        to: composeTo.trim(),
        subject: composeSubject.trim(),
        body_text: composeBody,
      });

      if (res?.delivery_report?.sent_via_relay) {
        toast.success(
          `Delivered to ${composeTo.trim()} via ${res.delivery_report.provider || "SMTP Relay"}!`,
        );
      } else if (res?.delivery_report?.error) {
        toast.error(`Relay Error: ${res.delivery_report.error}`);
      } else {
        toast.info(res?.delivery_report?.notice || "Email saved to local sent folder.");
      }

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

  async function handleToggleStar(msg: EmailMessage) {
    try {
      await engine.call("POST", `/api/email/messages/${msg.id}/star`);
      refetchMessages();
      if (selectedMessage?.id === msg.id) {
        setSelectedMessage({ ...selectedMessage, is_starred: selectedMessage.is_starred ? 0 : 1 });
      }
    } catch (e) {}
  }

  async function handleMoveToTrash(msgId: string) {
    try {
      if (folder === "trash") {
        await engine.call("DELETE", `/api/email/messages/${msgId}`);
        toast.success("Message permanently deleted");
      } else {
        await engine.call("POST", `/api/email/messages/${msgId}/move`, { folder: "trash" });
        toast.success("Moved to Trash");
      }
      setSelectedMessage(null);
      refetchMessages();
    } catch (e: any) {
      toast.error(e.message || "Failed to move message");
    }
  }

  function handleSelectTemplate(tpl: (typeof EMAIL_TEMPLATES)[0]) {
    setComposeSubject(tpl.subject);
    setComposeBody(tpl.body);
    toast.success(`Loaded template: ${tpl.name}`);
  }

  function handleCopy(text: string, id: string) {
    navigator.clipboard.writeText(text);
    setCopiedKey(id);
    toast.success("DNS record copied to clipboard!");
    setTimeout(() => setCopiedKey(null), 2000);
  }

  const unreadCount = messages.filter((m) => !m.is_read && folder === "inbox").length;
  const storageMb = (messages.length * 0.04).toFixed(2);

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
              <Mail className="w-3 h-3 mr-1" /> Self-Hosted Email Stack
            </Badge>
            <span className="text-xs text-muted-foreground">Production Engine</span>
          </div>
          <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text">
            Mailboxes & Email Stack
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Domain mailboxes, DNS anti-spam verification, inbound webhook piping, and outbound SMTP
            relays.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={() => setAddDomainOpen(true)}>
            <Globe className="w-4 h-4 mr-2" />
            Add Email Domain
          </Button>
          <Button
            size="sm"
            className="bg-primary hover:bg-primary/90 text-primary-foreground shadow-sm"
            onClick={() => setComposeOpen(true)}
          >
            <Send className="w-4 h-4 mr-2" />
            Compose Email
          </Button>
        </div>
      </div>

      {/* Navigation Sub-Tabs */}
      <div className="flex items-center gap-2 border-b border-border/60 pb-3">
        <button
          onClick={() => setActiveTab("webmail")}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            activeTab === "webmail"
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-muted/40 hover:text-foreground"
          }`}
        >
          <Inbox className="w-3.5 h-3.5" /> Mailboxes & Webmail
        </button>
        <button
          onClick={() => setActiveTab("aliases")}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            activeTab === "aliases"
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-muted/40 hover:text-foreground"
          }`}
        >
          <Forward className="w-3.5 h-3.5" /> Aliases & Inbound Webhooks ({aliases.length})
        </button>
        <button
          onClick={() => setActiveTab("relays")}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            activeTab === "relays"
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-muted/40 hover:text-foreground"
          }`}
        >
          <Server className="w-3.5 h-3.5" /> Outbound SMTP Relays ({relays.length})
        </button>
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
                  {activeDomain.alias_count ? (
                    <Badge variant="outline" className="text-[10px] py-0 px-2 font-mono">
                      {activeDomain.alias_count} Aliases
                    </Badge>
                  ) : null}
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
                    {copiedKey === `dns_${i}` ? (
                      <Check className="w-3 h-3 text-emerald-400" />
                    ) : (
                      <Copy className="w-3 h-3" />
                    )}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tab 1: Webmail Workspace */}
      {activeTab === "webmail" && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Sidebar: Mailboxes & Folders */}
          <div className="lg:col-span-3 rounded-xl border bg-card/60 p-4 shadow-sm space-y-5">
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Mailboxes
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0"
                  onClick={() => setAddMailboxOpen(true)}
                >
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
                      activeMailbox?.id === mbox.id
                        ? "bg-primary/10 text-primary font-medium"
                        : "hover:bg-muted/40 text-foreground"
                    }`}
                  >
                    <div className="truncate">
                      <div className="font-semibold truncate">{mbox.name}</div>
                      <div className="text-[11px] text-muted-foreground truncate">{mbox.email}</div>
                    </div>
                    <Badge variant="outline" className="text-[10px] font-mono shrink-0 ml-1">
                      {mbox.quota_mb}MB
                    </Badge>
                  </button>
                ))}
              </div>
            </div>

            {/* Folders */}
            <div>
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground block mb-2">
                Folders
              </span>
              <div className="space-y-1">
                <button
                  onClick={() => {
                    setFolder("inbox");
                    setSelectedMessage(null);
                  }}
                  className={`w-full flex items-center justify-between p-2 rounded-lg text-xs transition-colors ${
                    folder === "inbox"
                      ? "bg-primary text-primary-foreground font-medium"
                      : "hover:bg-muted/40 text-muted-foreground"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <Inbox className="w-3.5 h-3.5" /> Inbox
                  </div>
                  {unreadCount > 0 && (
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                      {unreadCount}
                    </Badge>
                  )}
                </button>
                <button
                  onClick={() => {
                    setFolder("sent");
                    setSelectedMessage(null);
                  }}
                  className={`w-full flex items-center gap-2 p-2 rounded-lg text-xs transition-colors ${
                    folder === "sent"
                      ? "bg-primary text-primary-foreground font-medium"
                      : "hover:bg-muted/40 text-muted-foreground"
                  }`}
                >
                  <Send className="w-3.5 h-3.5" /> Sent Messages
                </button>
                <button
                  onClick={() => {
                    setFolder("trash");
                    setSelectedMessage(null);
                  }}
                  className={`w-full flex items-center gap-2 p-2 rounded-lg text-xs transition-colors ${
                    folder === "trash"
                      ? "bg-primary text-primary-foreground font-medium"
                      : "hover:bg-muted/40 text-muted-foreground"
                  }`}
                >
                  <Trash2 className="w-3.5 h-3.5" /> Trash
                </button>
              </div>
            </div>

            {/* Mailbox Storage Meter */}
            <div className="border-t border-border/40 pt-4 space-y-2 text-xs">
              <div className="flex items-center justify-between text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <HardDrive className="w-3.5 h-3.5" /> Storage Used
                </span>
                <span className="font-mono text-[11px]">
                  {storageMb} MB / {activeMailbox?.quota_mb || 1024} MB
                </span>
              </div>
              <div className="w-full bg-muted/40 rounded-full h-1.5 overflow-hidden">
                <div
                  className="bg-primary h-full transition-all duration-300"
                  style={{
                    width: `${Math.min(100, (Number(storageMb) / (activeMailbox?.quota_mb || 1024)) * 100)}%`,
                  }}
                />
              </div>
            </div>
          </div>

          {/* Middle: Email List */}
          <div className="lg:col-span-4 rounded-xl border bg-card/60 shadow-sm overflow-hidden flex flex-col">
            <div className="p-3.5 border-b border-border/40 flex items-center justify-between bg-muted/10">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground capitalize">
                {folder} ({messages.length})
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                onClick={() => refetchMessages()}
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </Button>
            </div>

            {messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center p-12 text-center text-muted-foreground">
                <Inbox className="w-8 h-8 opacity-20 mb-2" />
                <p className="text-xs">No emails in {folder}</p>
              </div>
            ) : (
              <div className="divide-y divide-border/30 max-h-[520px] overflow-y-auto">
                {messages.map((msg) => (
                  <div
                    key={msg.id}
                    onClick={() => setSelectedMessage(msg)}
                    className={`p-3 text-xs cursor-pointer transition-colors relative ${
                      selectedMessage?.id === msg.id
                        ? "bg-primary/10"
                        : msg.is_read
                          ? "hover:bg-muted/30 opacity-75"
                          : "hover:bg-muted/30 font-medium"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-semibold truncate text-foreground">
                        {folder === "sent" ? msg.to_address : msg.from_address}
                      </span>
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleToggleStar(msg);
                          }}
                          className={`text-muted-foreground hover:text-amber-400 ${msg.is_starred ? "text-amber-400" : ""}`}
                        >
                          <Star className="w-3.5 h-3.5 fill-current" />
                        </button>
                        <span className="text-[10px] text-muted-foreground font-mono">
                          {new Date(msg.created_at).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </div>
                    </div>
                    <div className="text-foreground truncate font-medium">{msg.subject}</div>
                    <div className="text-muted-foreground text-[11px] truncate mt-0.5">
                      {msg.body_text}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Right: Message Detail Viewer */}
          <div className="lg:col-span-5 rounded-xl border bg-card/60 p-5 shadow-sm min-h-[440px] flex flex-col justify-between">
            {selectedMessage ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between border-b border-border/40 pb-3">
                  <div>
                    <h3 className="text-base font-bold text-foreground">
                      {selectedMessage.subject}
                    </h3>
                    <div className="text-xs text-muted-foreground mt-1 space-y-0.5 font-mono">
                      <div>
                        From:{" "}
                        <span className="text-foreground">{selectedMessage.from_address}</span>
                      </div>
                      <div>
                        To: <span className="text-foreground">{selectedMessage.to_address}</span>
                      </div>
                      <div>Date: {new Date(selectedMessage.created_at).toLocaleString()}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => handleToggleStar(selectedMessage)}
                      className={`p-1.5 rounded-md hover:bg-muted/40 ${selectedMessage.is_starred ? "text-amber-400" : "text-muted-foreground"}`}
                    >
                      <Star className="w-4 h-4 fill-current" />
                    </button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                      onClick={() => handleMoveToTrash(selectedMessage.id)}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>

                <div className="text-xs text-foreground leading-relaxed whitespace-pre-wrap p-4 bg-muted/10 rounded-lg border border-border/30">
                  {selectedMessage.body_text}
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center p-16 text-center text-muted-foreground my-auto">
                <FileText className="w-8 h-8 opacity-20 mb-2" />
                <p className="text-xs font-medium">Select an email to read its contents</p>
                <p className="text-[11px] text-muted-foreground mt-1">
                  Or click Compose Email to transmit outbound mail.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab 2: Aliases & Inbound Webhook Forwarders */}
      {activeTab === "aliases" && (
        <div className="rounded-xl border bg-card/60 p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between border-b border-border/40 pb-3">
            <div>
              <h3 className="text-base font-semibold">Email Aliases & Webhook Forwarders</h3>
              <p className="text-xs text-muted-foreground">
                Route incoming emails to external addresses or pipe raw email payloads directly into
                HTTP Webhook endpoints.
              </p>
            </div>
            <Button size="sm" onClick={() => setAddAliasOpen(true)}>
              <Plus className="w-4 h-4 mr-1.5" /> Add Alias
            </Button>
          </div>

          {aliases.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground">
              <Forward className="w-8 h-8 opacity-20 mx-auto mb-2" />
              <p className="text-xs">No email aliases created yet for {activeDomain?.domain}</p>
            </div>
          ) : (
            <div className="divide-y divide-border/30">
              {aliases.map((al) => (
                <div key={al.id} className="py-3 flex items-center justify-between text-xs">
                  <div className="space-y-1">
                    <div className="font-semibold text-foreground flex items-center gap-2">
                      {al.source_email}
                      <Badge variant="outline" className="text-[10px] uppercase font-mono">
                        {al.destination_type}
                      </Badge>
                      {aliasTestResult[al.id] && (
                        <Badge
                          className={`text-[10px] font-mono ${
                            aliasTestResult[al.id].ok
                              ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                              : "bg-destructive/10 text-destructive"
                          }`}
                        >
                          {aliasTestResult[al.id].ok
                            ? `HTTP ${aliasTestResult[al.id].status} (${aliasTestResult[al.id].latency_ms}ms)`
                            : "Webhook Fail"}
                        </Badge>
                      )}
                    </div>
                    <div className="text-muted-foreground font-mono text-[11px] flex items-center gap-1.5">
                      <Forward className="w-3 h-3 text-primary" /> {al.destination_target}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {al.destination_type === "webhook" && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 text-xs"
                        disabled={testingAliasId === al.id}
                        onClick={() => handleTestWebhook(al.id)}
                      >
                        {testingAliasId === al.id ? (
                          <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                        ) : (
                          <Zap className="w-3 h-3 mr-1 text-primary" />
                        )}
                        Test Webhook
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                      onClick={() => handleDeleteAlias(al.id)}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab 3: Outbound SMTP Relays */}
      {activeTab === "relays" && (
        <div className="rounded-xl border bg-card/60 p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between border-b border-border/40 pb-3">
            <div>
              <h3 className="text-base font-semibold">Outbound SMTP Relays</h3>
              <p className="text-xs text-muted-foreground">
                Connect Resend, Gmail, Brevo, AWS SES, Postmark, or SendGrid for 100% inbox
                deliverability.
              </p>
            </div>
            <Button size="sm" onClick={() => setAddRelayOpen(true)}>
              <Plus className="w-4 h-4 mr-1.5" /> Connect SMTP Relay
            </Button>
          </div>

          {/* Quick Preset Selector Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5 pb-2">
            {PRESET_RELAYS.map((preset) => (
              <div
                key={preset.name}
                onClick={() => {
                  setRelayName(`${preset.name} Relay`);
                  setRelayProvider(preset.provider);
                  setRelayHost(preset.host);
                  setRelayPort(preset.port);
                  setRelayUsername(preset.username);
                  setAddRelayOpen(true);
                }}
                className="p-3 rounded-lg border bg-muted/20 hover:bg-muted/40 cursor-pointer transition-all border-border/40 hover:border-primary/40 space-y-1.5 text-xs"
              >
                <div className="font-semibold flex items-center justify-between text-foreground">
                  <span>{preset.name}</span>
                  <ArrowRight className="w-3 h-3 text-muted-foreground" />
                </div>
                <p className="text-[11px] text-muted-foreground leading-tight">{preset.help}</p>
              </div>
            ))}
          </div>

          {relays.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground">
              <Server className="w-8 h-8 opacity-20 mx-auto mb-2" />
              <p className="text-xs">
                No external SMTP relays configured. Click a preset above or connect a custom relay.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border/30">
              {relays.map((rel) => (
                <div key={rel.id} className="py-3 flex items-center justify-between text-xs">
                  <div className="space-y-1">
                    <div className="font-semibold text-foreground flex items-center gap-2">
                      {rel.name}
                      <Badge variant="secondary" className="text-[10px] uppercase font-mono">
                        {rel.provider}
                      </Badge>
                      {rel.is_default ? (
                        <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 text-[10px]">
                          Default Outbound
                        </Badge>
                      ) : null}
                    </div>
                    <div className="text-muted-foreground font-mono text-[11px]">
                      {rel.host}:{rel.port} (User: {rel.username || "anonymous"})
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 text-xs"
                      disabled={testingRelayId === rel.id}
                      onClick={() => handleTestRelay(rel)}
                    >
                      {testingRelayId === rel.id ? (
                        <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                      ) : (
                        <Zap className="w-3 h-3 mr-1" />
                      )}
                      Test Authentication
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                      onClick={() => handleDeleteRelay(rel.id)}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Add Domain Modal */}
      <Dialog open={addDomainOpen} onOpenChange={setAddDomainOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add Email Domain</DialogTitle>
            <DialogDescription>
              Register a domain to provision self-hosted mailboxes and calculate DNS anti-spam
              records.
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
            <Button variant="outline" onClick={() => setAddDomainOpen(false)}>
              Cancel
            </Button>
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
                  placeholder="e.g. meet"
                  value={newMailboxEmail}
                  onChange={(e) => setNewMailboxEmail(e.target.value)}
                />
                <span className="text-xs font-mono text-muted-foreground">
                  @{activeDomain?.domain}
                </span>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Display Name</Label>
              <Input
                placeholder="e.g. Meet Patel"
                value={newMailboxName}
                onChange={(e) => setNewMailboxName(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddMailboxOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateMailbox}>Create Mailbox</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Alias Modal */}
      <Dialog open={addAliasOpen} onOpenChange={setAddAliasOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create Inbound Alias / Webhook</DialogTitle>
            <DialogDescription>
              Forward incoming emails to external inboxes or pipe directly to API endpoints.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label>Source Alias</Label>
              <div className="flex items-center gap-2">
                <Input
                  placeholder="support"
                  value={newAliasSource}
                  onChange={(e) => setNewAliasSource(e.target.value)}
                />
                <span className="text-xs font-mono text-muted-foreground">
                  @{activeDomain?.domain}
                </span>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Destination Type</Label>
              <select
                value={newAliasType}
                onChange={(e) => setNewAliasType(e.target.value as any)}
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-xs"
              >
                <option value="email">Forward to External Email (e.g. personal@gmail.com)</option>
                <option value="webhook">Pipe to HTTP Webhook URL (POST JSON)</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Destination Target</Label>
              <Input
                placeholder={
                  newAliasType === "email"
                    ? "user@example.com"
                    : "https://api.mycompany.com/webhooks/inbound-mail"
                }
                value={newAliasTarget}
                onChange={(e) => setNewAliasTarget(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddAliasOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateAlias}>Create Alias</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add SMTP Relay Modal */}
      <Dialog open={addRelayOpen} onOpenChange={setAddRelayOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Connect Outbound SMTP Relay</DialogTitle>
            <DialogDescription>
              Route outbound system emails through high-reputation delivery providers.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2 text-xs">
            <div className="space-y-1">
              <Label>Configuration Name</Label>
              <Input
                placeholder="Resend Production Relay"
                value={relayName}
                onChange={(e) => setRelayName(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>Provider</Label>
              <select
                value={relayProvider}
                onChange={(e) => {
                  const p = e.target.value as any;
                  setRelayProvider(p);
                  if (p === "resend") {
                    setRelayHost("smtp.resend.com");
                    setRelayUsername("resend");
                  } else if (p === "postmark") {
                    setRelayHost("smtp.postmarkapp.com");
                    setRelayUsername("");
                  } else if (p === "ses") {
                    setRelayHost("email-smtp.us-east-1.amazonaws.com");
                  } else if (p === "sendgrid") {
                    setRelayHost("smtp.sendgrid.net");
                    setRelayUsername("apikey");
                  }
                }}
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-xs"
              >
                <option value="resend">Resend (smtp.resend.com)</option>
                <option value="custom">Personal Gmail (smtp.gmail.com)</option>
                <option value="custom">Brevo / Sendinblue (smtp-relay.brevo.com)</option>
                <option value="postmark">Postmark (smtp.postmarkapp.com)</option>
                <option value="ses">Amazon SES</option>
                <option value="sendgrid">SendGrid</option>
              </select>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="col-span-2 space-y-1">
                <Label>SMTP Host</Label>
                <Input value={relayHost} onChange={(e) => setRelayHost(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Port</Label>
                <Input
                  type="number"
                  value={relayPort}
                  onChange={(e) => setRelayPort(Number(e.target.value))}
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Username / API Key</Label>
              <Input value={relayUsername} onChange={(e) => setRelayUsername(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Password / Secret</Label>
              <Input
                type="password"
                placeholder="••••••••••••"
                value={relayPassword}
                onChange={(e) => setRelayPassword(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>From Email (Optional envelope override)</Label>
              <Input
                placeholder="onboarding@resend.dev or verified domain"
                value={relayFromEmail}
                onChange={(e) => setRelayFromEmail(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddRelayOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveRelay}>Save Relay</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Compose Email Modal with Live Preview & Templates */}
      <Dialog open={composeOpen} onOpenChange={setComposeOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <div className="flex items-center justify-between pr-6">
              <DialogTitle>Compose Email</DialogTitle>
              <div className="flex items-center gap-1 bg-muted/40 p-0.5 rounded-lg border border-border/40">
                <button
                  type="button"
                  onClick={() => setComposeMode("edit")}
                  className={`px-2 py-1 rounded text-[11px] font-medium transition-colors flex items-center gap-1 ${
                    composeMode === "edit"
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Edit3 className="w-3 h-3" /> Edit
                </button>
                <button
                  type="button"
                  onClick={() => setComposeMode("preview")}
                  className={`px-2 py-1 rounded text-[11px] font-medium transition-colors flex items-center gap-1 ${
                    composeMode === "preview"
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Eye className="w-3 h-3" /> Preview
                </button>
              </div>
            </div>
            <DialogDescription>
              Sending from{" "}
              <span className="font-mono font-medium text-foreground">
                {activeMailbox?.email || "active mailbox"}
              </span>
            </DialogDescription>
          </DialogHeader>

          {/* Quick Insert Templates Pills */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
            <span className="text-[11px] text-muted-foreground shrink-0 flex items-center gap-1">
              <Sparkles className="w-3 h-3 text-primary" /> Templates:
            </span>
            {EMAIL_TEMPLATES.map((tpl) => (
              <button
                key={tpl.id}
                type="button"
                onClick={() => handleSelectTemplate(tpl)}
                className="px-2 py-0.5 rounded-md border bg-muted/20 hover:bg-muted/40 text-[11px] text-muted-foreground hover:text-foreground shrink-0 transition-colors"
              >
                {tpl.name}
              </button>
            ))}
          </div>

          {composeMode === "edit" ? (
            <div className="space-y-3 py-1 text-xs">
              <div className="space-y-1">
                <Label>Recipient (To:)</Label>
                <Input
                  placeholder="admin@example.com"
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
                  className="w-full h-36 rounded-md border border-input bg-background p-3 text-xs outline-none focus:border-primary font-sans leading-relaxed"
                  placeholder="Type your message here..."
                  value={composeBody}
                  onChange={(e) => setComposeBody(e.target.value)}
                />
              </div>
            </div>
          ) : (
            <div className="space-y-3 py-2 text-xs border rounded-lg p-4 bg-muted/10">
              <div className="border-b border-border/40 pb-2 space-y-1 font-mono text-[11px]">
                <div>
                  <span className="text-muted-foreground">To:</span> {composeTo || "<recipient>"}
                </div>
                <div>
                  <span className="text-muted-foreground">Subject:</span>{" "}
                  <span className="font-bold text-foreground">
                    {composeSubject || "No Subject"}
                  </span>
                </div>
              </div>
              <div className="whitespace-pre-wrap text-foreground leading-relaxed pt-1">
                {composeBody || (
                  <span className="text-muted-foreground italic">Message body is empty...</span>
                )}
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setComposeOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSendMessage} disabled={sending}>
              {sending ? (
                <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
              ) : (
                <Send className="w-3.5 h-3.5 mr-1" />
              )}
              {sending ? "Sending..." : "Send Email"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
