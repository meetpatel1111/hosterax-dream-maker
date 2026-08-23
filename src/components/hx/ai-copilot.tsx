// src/components/hx/ai-copilot.tsx
// HosteraX Conversational AIOps Copilot with Granular RBAC Permissions & Full Platform Control

import { useState, useEffect, useRef } from "react";
import {
  Sparkles,
  Send,
  Terminal,
  Shield,
  ShieldAlert,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Loader2,
  Zap,
  Minimize2,
  Maximize2,
  X,
  RotateCcw,
  Cpu,
  Server,
  Activity,
  Trash2,
  HelpCircle,
} from "lucide-react";
import {
  useAiChat,
  useAiConfig,
  type AiConfirmationRequired,
  type AiToolCall,
} from "@/lib/engine";
import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/utils";

interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  toolCalls?: AiToolCall[];
  confirmationRequired?: AiConfirmationRequired | null;
  timestamp: number;
}

const QUICK_PROMPTS = [
  { label: "🔍 Diagnose Cluster", prompt: "Diagnose cluster health and check for failing containers" },
  { label: "📊 Live Metrics", prompt: "Show system metrics and node telemetry" },
  { label: "⚡ Reclaim RAM", prompt: "Reclaim idle memory across all containers" },
  { label: "📜 Error Logs", prompt: "Search error logs in stirling-pdf" },
  { label: "🌿 PR Previews", prompt: "List active ephemeral PR preview environments" },
  { label: "🧠 Check GPU", prompt: "Show NVIDIA GPU VRAM allocation and check if llama3:8b fits" },
  { label: "🚀 Restart Service", prompt: "Restart stirling-pdf and verify readiness probe" },
  { label: "🛡️ SSL & DNS", prompt: "Check edge routing and SSL status" },
];

export function AICopilot() {
  const [isOpen, setIsOpen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pendingConfirmation, setPendingConfirmation] = useState<AiConfirmationRequired | null>(null);
  
  const { user } = useAuth();
  const userRole = (user?.role as string) || "admin";
  const userEmail = (user?.email as string) || "admin@hosterax.local";

  const chatMutation = useAiChat();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Global Keyboard Shortcut: Cmd+K / Ctrl+K / Ctrl+Space
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K" || e.code === "Space")) {
        e.preventDefault();
        setIsOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Initial welcome message
  useEffect(() => {
    if (messages.length === 0) {
      setMessages([
        {
          id: "welcome",
          role: "assistant",
          content: `👋 **HosteraX AIOps Copilot Active**\n\nI have full operational control over your infrastructure stack, governed by your **\`${userRole.toUpperCase()}\`** RBAC role.\n\nType any natural language command (e.g. *"Restart stirling-pdf"*, *"Diagnose cluster"*, *"Scale to zero after 15m"*, *"Show GPU telemetry"*), or pick a quick action below.`,
          timestamp: Date.now(),
        },
      ]);
    }
  }, [userRole, messages.length]);

  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
      setTimeout(() => inputRef.current?.focus(), 150);
    }
  }, [isOpen, messages]);

  const handleSend = async (customPrompt?: string) => {
    const promptToSend = customPrompt || input.trim();
    if (!promptToSend || chatMutation.isPending) return;

    setInput("");
    const userMsgId = `usr_${Date.now()}`;
    const userMsg: ChatMessage = {
      id: userMsgId,
      role: "user",
      content: promptToSend,
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, userMsg]);

    try {
      const history = messages.map((m) => ({
        role: m.role === "system" ? "assistant" : m.role,
        content: m.content,
      }));

      const res = await chatMutation.mutateAsync({
        prompt: promptToSend,
        conversationHistory: history,
        userRole,
        userEmail,
      });

      const assistantMsg: ChatMessage = {
        id: `asst_${Date.now()}`,
        role: "assistant",
        content: res.reply,
        toolCalls: res.toolCalls,
        confirmationRequired: res.confirmationRequired,
        timestamp: Date.now(),
      };

      if (res.confirmationRequired) {
        setPendingConfirmation(res.confirmationRequired);
      }

      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err: any) {
      setMessages((prev) => [
        ...prev,
        {
          id: `err_${Date.now()}`,
          role: "assistant",
          content: `❌ **Error executing command:** ${err.message || "Network timeout"}`,
          timestamp: Date.now(),
        },
      ]);
    }
  };

  const handleConfirmAction = async (confirmed: boolean) => {
    if (!pendingConfirmation) return;

    if (!confirmed) {
      setPendingConfirmation(null);
      setMessages((prev) => [
        ...prev,
        {
          id: `cncl_${Date.now()}`,
          role: "system",
          content: `🛡️ **Action Cancelled:** Execution of \`${pendingConfirmation.toolName}\` was cancelled by the user.`,
          timestamp: Date.now(),
        },
      ]);
      return;
    }

    const actionToExecute = pendingConfirmation;
    setPendingConfirmation(null);

    try {
      const res = await chatMutation.mutateAsync({
        confirmedAction: {
          toolName: actionToExecute.toolName,
          parameters: actionToExecute.parameters,
        },
        userRole,
        userEmail,
      });

      setMessages((prev) => [
        ...prev,
        {
          id: `conf_res_${Date.now()}`,
          role: "assistant",
          content: res.reply,
          toolCalls: res.toolCalls,
          timestamp: Date.now(),
        },
      ]);
    } catch (err: any) {
      setMessages((prev) => [
        ...prev,
        {
          id: `err_${Date.now()}`,
          role: "assistant",
          content: `❌ **Failed to execute confirmed action:** ${err.message}`,
          timestamp: Date.now(),
        },
      ]);
    }
  };

  return (
    <>
      {/* Floating Trigger Button (Bottom-Right) */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="fixed bottom-6 right-6 z-50 flex items-center gap-2.5 rounded-full bg-gradient-to-r from-primary via-emerald-400 to-primary px-4 py-2.5 text-primary-foreground font-semibold shadow-xl shadow-primary/20 hover:scale-105 active:scale-95 transition-all duration-200 border border-primary/40 group"
          title="Open HosteraX AIOps Copilot (Cmd+K)"
        >
          <div className="relative flex items-center justify-center">
            <Sparkles className="w-4 h-4 animate-pulse text-background" />
          </div>
          <span className="text-xs font-mono font-bold tracking-tight text-background">AI Copilot</span>
          <span className="hidden sm:inline-block rounded bg-background/20 px-1.5 py-0.5 text-[10px] font-mono text-background">
            ⌘K
          </span>
        </button>
      )}

      {/* Copilot Drawer / Modal */}
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:justify-end sm:pr-6 pointer-events-none">
          {/* Backdrop (mobile only) */}
          <div
            className="fixed inset-0 bg-background/60 backdrop-blur-sm sm:hidden pointer-events-auto"
            onClick={() => setIsOpen(false)}
          />

          <div
            className={cn(
              "pointer-events-auto flex flex-col bg-card/95 backdrop-blur-md border border-border/80 rounded-t-2xl sm:rounded-2xl shadow-2xl transition-all duration-300 overflow-hidden font-sans",
              isExpanded
                ? "w-full h-full sm:w-[850px] sm:h-[85vh]"
                : "w-full h-[620px] sm:w-[540px] sm:h-[700px]"
            )}
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-border/60 px-4 py-3 bg-muted/40 shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/15 border border-primary/30 text-primary">
                  <Sparkles className="w-4 h-4" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-foreground">HosteraX AIOps Copilot</h3>
                    {/* RBAC Role Indicator Badge */}
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium font-mono uppercase tracking-wider",
                        userRole === "owner" || userRole === "admin"
                          ? "bg-primary/15 text-primary border border-primary/30"
                          : userRole === "member" || userRole === "operator"
                          ? "bg-amber-500/15 text-amber-400 border border-amber-500/30"
                          : "bg-muted text-muted-foreground border border-border"
                      )}
                    >
                      <Shield className="w-2.5 h-2.5" />
                      {userRole} Access
                    </span>
                  </div>
                  <p className="text-[11px] text-muted-foreground font-mono">
                    Natural Language Infrastructure & Troubleshooting
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1">
                <button
                  onClick={() => setIsExpanded(!isExpanded)}
                  className="hidden sm:inline-flex p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
                  title={isExpanded ? "Collapse" : "Expand"}
                >
                  {isExpanded ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                </button>
                <button
                  onClick={() => setIsOpen(false)}
                  className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Quick Action Chips */}
            <div className="flex items-center gap-1.5 px-4 py-2 border-b border-border/40 overflow-x-auto no-scrollbar bg-background/50 shrink-0">
              {QUICK_PROMPTS.map((qp, i) => (
                <button
                  key={i}
                  onClick={() => handleSend(qp.prompt)}
                  disabled={chatMutation.isPending}
                  className="whitespace-nowrap rounded-md bg-muted/60 hover:bg-muted px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-all duration-150 border border-border/50 active:scale-95"
                >
                  {qp.label}
                </button>
              ))}
            </div>

            {/* Chat Stream Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4 font-sans text-xs">
              {messages.map((m) => (
                <div
                  key={m.id}
                  className={cn(
                    "flex flex-col gap-1.5 max-w-[92%]",
                    m.role === "user" ? "ml-auto items-end" : "mr-auto items-start"
                  )}
                >
                  <div
                    className={cn(
                      "rounded-xl px-3.5 py-2.5 shadow-sm text-xs leading-relaxed",
                      m.role === "user"
                        ? "bg-primary text-primary-foreground font-medium"
                        : m.role === "system"
                        ? "bg-amber-500/10 border border-amber-500/30 text-amber-300"
                        : "bg-muted/80 text-foreground border border-border/60"
                    )}
                  >
                    {/* Tool Calls Execution Pill */}
                    {m.toolCalls && m.toolCalls.length > 0 && (
                      <div className="mb-2.5 space-y-1.5 border-b border-border/50 pb-2">
                        {m.toolCalls.map((tc, idx) => (
                          <div
                            key={idx}
                            className={cn(
                              "flex items-center gap-2 rounded px-2 py-1 text-[10px] font-mono",
                              tc.status === "success"
                                ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                                : tc.status === "denied_rbac"
                                ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                                : "bg-destructive/10 text-destructive border border-destructive/20"
                            )}
                          >
                            <Terminal className="w-3 h-3 shrink-0" />
                            <span className="font-semibold">tool: {tc.toolName}</span>
                            <span className="ml-auto font-mono text-[9px] uppercase">
                              {tc.status === "success" ? "✓ Executed" : tc.status === "denied_rbac" ? "🛡️ Denied" : "✗ Failed"}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Markdown Formatted Text */}
                    <div className="prose prose-invert prose-xs max-w-none whitespace-pre-wrap font-sans">
                      {m.content}
                    </div>

                    {/* Destructive Action Confirmation Card */}
                    {m.confirmationRequired && (
                      <div className="mt-3 rounded-lg bg-destructive/10 border border-destructive/30 p-3 text-destructive-foreground">
                        <div className="flex items-center gap-2 font-semibold text-destructive text-xs">
                          <AlertTriangle className="w-4 h-4" />
                          <span>{m.confirmationRequired.title}</span>
                        </div>
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          {m.confirmationRequired.warning}
                        </p>
                        <div className="mt-3 flex items-center gap-2">
                          <button
                            onClick={() => handleConfirmAction(true)}
                            disabled={chatMutation.isPending}
                            className="rounded bg-destructive px-3 py-1 text-xs font-semibold text-destructive-foreground hover:bg-destructive/90 transition-colors shadow-sm active:scale-95"
                          >
                            Confirm & Execute
                          </button>
                          <button
                            onClick={() => handleConfirmAction(false)}
                            disabled={chatMutation.isPending}
                            className="rounded bg-muted px-3 py-1 text-xs font-medium text-foreground hover:bg-muted/80 transition-colors active:scale-95"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  <span className="text-[9px] text-muted-foreground px-1 font-mono">
                    {new Date(m.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
              ))}

              {chatMutation.isPending && (
                <div className="flex items-center gap-2 text-muted-foreground text-xs p-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
                  <span className="font-mono text-[11px]">Executing AIOps command...</span>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input Bar */}
            <div className="p-3 border-t border-border/60 bg-muted/30 shrink-0">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSend();
                }}
                className="flex items-center gap-2"
              >
                <div className="relative flex-1">
                  <input
                    ref={inputRef}
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder={
                      userRole === "viewer"
                        ? "Ask about cluster health, logs, diagnostics (Read-Only)..."
                        : "Type any command (e.g. 'restart stirling-pdf', 'scale to zero 15m')..."
                    }
                    disabled={chatMutation.isPending}
                    className="w-full rounded-xl bg-background border border-border/80 px-3.5 py-2.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary font-sans transition-all"
                  />
                </div>
                <button
                  type="submit"
                  disabled={!input.trim() || chatMutation.isPending}
                  className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-40 transition-all shrink-0 active:scale-95 shadow-sm"
                >
                  {chatMutation.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Send className="w-4 h-4" />
                  )}
                </button>
              </form>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
