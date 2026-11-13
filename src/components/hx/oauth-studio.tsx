import { useState, useId, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ShieldCheck,
  Plus,
  KeyRound,
  Bot,
  Copy,
  Check,
  Trash2,
  RefreshCw,
  Code2,
  Terminal,
  AlertTriangle,
  Layers,
} from "lucide-react";
import {
  type OAuthClientType,
  type OAuthScope,
  type PkcePair,
  AVAILABLE_OAUTH_SCOPES,
  OAUTH_PRESET_TEMPLATES,
  generatePkcePair,
  validateRedirectUri,
  buildAuthorizationUrl,
} from "@/utils/oauth-engine";
import { useEngine, useActiveOrgId } from "@/lib/engine";
import { confirmAction } from "@/components/hx/confirm-modal";
import { appLogger } from "@/utils/app-logger";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type BackendOAuthClient = {
  id: string;
  org_id: string;
  name: string;
  client_id: string;
  client_type: "public" | "confidential";
  redirectUris: string[];
  scopes: string[];
  mcpEnabled: boolean;
  hasSecret: boolean;
  created_at: number;
};

export function OAuthStudio() {
  const engine = useEngine();
  const orgId = useActiveOrgId();
  const qc = useQueryClient();

  const searchInputId = useId();
  const modalAppNameId = useId();
  const modalRedirectInputId = useId();

  const { data: clients = [], isLoading } = useQuery<BackendOAuthClient[]>({
    queryKey: ["oauth-clients", engine.url, engine.token, orgId],
    queryFn: () => engine.call<BackendOAuthClient[]>("GET", "/api/oauth/clients"),
  });

  const [activeTab, setActiveTab] = useState<"apps" | "pkce_simulator" | "mcp_configs">("apps");
  const [searchQuery, setSearchQuery] = useState("");
  const [registerModalOpen, setRegisterModalOpen] = useState(false);
  const [secretModalData, setSecretModalData] = useState<{
    clientId: string;
    clientSecret?: string;
    appName: string;
  } | null>(null);

  const [newAppName, setNewAppName] = useState("");
  const [newClientType, setNewClientType] = useState<OAuthClientType>("public");
  const [newRedirectUris, setNewRedirectUris] = useState<string[]>([
    "http://localhost:3000/callback",
  ]);
  const [tempRedirectUri, setTempRedirectUri] = useState("");
  const [redirectError, setRedirectError] = useState<string | null>(null);
  const [selectedScopes, setSelectedScopes] = useState<OAuthScope[]>([
    "read:projects",
    "mcp:tools",
  ]);

  // Real PKCE Sandbox state backed by POST /api/oauth/authorize and POST /api/oauth/token
  const [simSelectedClientId, setSimSelectedClientId] = useState<string>("");
  const [simPkce, setSimPkce] = useState<PkcePair | null>(null);
  const [simAuthUrl, setSimAuthUrl] = useState("");
  const [simAuthCode, setSimAuthCode] = useState("");
  const [simTokenResponse, setSimTokenResponse] = useState<any | null>(null);
  const [simStep, setSimStep] = useState<1 | 2 | 3 | 4>(1);
  const [simBusy, setSimBusy] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const simSelectedClient = useMemo(
    () => clients.find((c) => c.client_id === simSelectedClientId) || clients[0] || null,
    [clients, simSelectedClientId],
  );

  const handleCopy = (text: string, label: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    toast.success(`${label} copied to clipboard!`);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const handleAddRedirectUri = () => {
    if (!tempRedirectUri.trim()) return;
    const check = validateRedirectUri(tempRedirectUri);
    if (!check.valid) {
      setRedirectError(check.error || "Invalid redirect URI");
      return;
    }
    if (newRedirectUris.includes(tempRedirectUri.trim())) {
      setRedirectError("Redirect URI is already added");
      return;
    }
    setNewRedirectUris([...newRedirectUris, tempRedirectUri.trim()]);
    setTempRedirectUri("");
    setRedirectError(null);
  };

  const applyTemplate = (template: (typeof OAUTH_PRESET_TEMPLATES)[0]) => {
    setNewAppName(template.name);
    setNewClientType(template.clientType);
    setNewRedirectUris([...template.redirectUris]);
    setSelectedScopes([...template.scopes]);
    toast.info(`Loaded preset template for ${template.name}`);
  };

  const handleCreateClient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAppName.trim()) return toast.error("Application name is required.");
    if (newRedirectUris.length === 0) return toast.error("Add at least one valid redirect URI.");
    if (selectedScopes.length === 0) return toast.error("Select at least one OAuth scope.");

    const created = await engine.call<{
      id: string;
      name: string;
      clientId: string;
      clientSecret: string | null;
      clientType: string;
    }>("POST", "/api/oauth/clients", {
      name: newAppName.trim(),
      clientType: newClientType,
      redirectUris: newRedirectUris,
      scopes: selectedScopes,
      mcpEnabled: true,
    });

    await qc.invalidateQueries({ queryKey: ["oauth-clients"] });
    setRegisterModalOpen(false);
    appLogger.logUi("OAUTH_CLIENT_CREATED", `Registered OAuth client ${created.name}`, {
      clientId: created.clientId,
    });

    if (created.clientSecret) {
      setSecretModalData({
        clientId: created.clientId,
        clientSecret: created.clientSecret,
        appName: created.name,
      });
    } else {
      toast.success(`${created.name} (Public / PKCE) registered in engine.`);
    }

    setNewAppName("");
    setNewRedirectUris(["http://localhost:3000/callback"]);
    setSelectedScopes(["read:projects", "mcp:tools"]);
  };

  const handleDeleteClient = async (client: BackendOAuthClient) => {
    const ok = await confirmAction({
      title: `Delete OAuth Client "${client.name}"`,
      description: `Revoke and delete OAuth 2.1 registration (${client.client_id})?`,
      variant: "destructive",
      confirmLabel: "Delete Client",
    });
    if (!ok) return;
    await engine.call("DELETE", `/api/oauth/clients/${encodeURIComponent(client.id)}`);
    await qc.invalidateQueries({ queryKey: ["oauth-clients"] });
    toast.success(`${client.name} removed from registry`);
  };

  const startPkceFlow = () => {
    if (!simSelectedClient) {
      toast.error("Register an OAuth client first.");
      return;
    }
    const pair = generatePkcePair(64);
    setSimPkce(pair);

    const stateBytes = new Uint8Array(8);
    crypto.getRandomValues(stateBytes);
    const state = Array.from(stateBytes, (b) => b.toString(16).padStart(2, "0")).join("");

    const redirectUri = simSelectedClient.redirectUris[0] || "http://localhost:3000/callback";
    const authUrl = buildAuthorizationUrl({
      endpoint: engine.url,
      clientId: simSelectedClient.client_id,
      redirectUri,
      scope: simSelectedClient.scopes.join(" "),
      state,
      codeChallenge: pair.codeChallenge,
      codeChallengeMethod: "S256",
    });

    setSimAuthUrl(authUrl);
    setSimAuthCode("");
    setSimTokenResponse(null);
    setSimStep(2);
  };

  const handleAuthorizeRequest = async () => {
    if (!simSelectedClient || !simPkce) return;
    setSimBusy(true);
    try {
      const res = await engine.call<{ ok: boolean; code: string; expiresIn: number }>(
        "POST",
        "/api/oauth/authorize",
        {
          clientId: simSelectedClient.client_id,
          redirectUri: simSelectedClient.redirectUris[0] || "http://localhost:3000/callback",
          scopes: simSelectedClient.scopes,
          codeChallenge: simPkce.codeChallenge,
          codeChallengeMethod: "S256",
        },
      );
      setSimAuthCode(res.code);
      setSimStep(3);
      toast.success("Authorization code issued by HosteraX OAuth server");
    } finally {
      setSimBusy(false);
    }
  };

  const handleTokenExchange = async () => {
    if (!simPkce || !simSelectedClient || !simAuthCode) return;
    setSimBusy(true);
    try {
      const tokenRes = await engine.call<{
        token_type: string;
        access_token: string;
        expires_in: number;
        scope: string;
      }>("POST", "/api/oauth/token", {
        code: simAuthCode,
        codeVerifier: simPkce.codeVerifier,
        clientId: simSelectedClient.client_id,
      });
      setSimTokenResponse(tokenRes);
      setSimStep(4);
      toast.success("PKCE S256 verified by engine! Real Bearer access token minted.");
    } finally {
      setSimBusy(false);
    }
  };

  const filteredClients = clients.filter(
    (c) =>
      c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.client_id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.scopes.some((s) => s.toLowerCase().includes(searchQuery.toLowerCase())),
  );

  return (
    <div
      className="w-full max-w-[1720px] 2xl:max-w-none mx-auto space-y-6"
      data-testid="oauth-studio"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-border/80 pb-6">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <ShieldCheck className="h-6 w-6 text-primary" />
              OAuth 2.1 &amp; MCP Client Registry
            </h1>
            <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-semibold text-emerald-400 border border-emerald-500/20">
              RFC 7636 PKCE Live
            </span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage registered OAuth 2.1 clients and test real server-backed authorization code &amp;
            PKCE exchanges.
          </p>
        </div>

        <button
          type="button"
          data-testid="btn-register-oauth-app"
          onClick={() => setRegisterModalOpen(true)}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-3.5 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90 transition-colors shadow-sm cursor-pointer"
        >
          <Plus className="h-4 w-4" />
          Register Application
        </button>
      </div>

      <div className="flex items-center gap-2 border-b border-border">
        <button
          type="button"
          onClick={() => setActiveTab("apps")}
          className={cn(
            "flex items-center gap-2 px-4 py-2 text-xs font-medium border-b-2 transition-colors cursor-pointer",
            activeTab === "apps"
              ? "border-primary text-primary font-semibold"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          <Layers className="h-4 w-4" />
          Registered Applications ({clients.length})
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("pkce_simulator")}
          className={cn(
            "flex items-center gap-2 px-4 py-2 text-xs font-medium border-b-2 transition-colors cursor-pointer",
            activeTab === "pkce_simulator"
              ? "border-primary text-primary font-semibold"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          <Code2 className="h-4 w-4" />
          Live PKCE Flow Sandbox
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("mcp_configs")}
          className={cn(
            "flex items-center gap-2 px-4 py-2 text-xs font-medium border-b-2 transition-colors cursor-pointer",
            activeTab === "mcp_configs"
              ? "border-primary text-primary font-semibold"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          <Bot className="h-4 w-4" />
          MCP Configurations
        </button>
      </div>

      {activeTab === "apps" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div className="relative flex-1 max-w-sm">
              <label htmlFor={searchInputId} className="sr-only">
                Search applications
              </label>
              <input
                id={searchInputId}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter applications by name, client ID or scope..."
                className="w-full rounded-md border border-input bg-card px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <span className="text-xs text-muted-foreground">
              Showing {filteredClients.length} of {clients.length} apps
            </span>
          </div>

          {isLoading ? (
            <div className="p-8 text-center text-xs text-muted-foreground">
              Loading registered OAuth applications...
            </div>
          ) : filteredClients.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border bg-card/50 p-12 text-center space-y-4">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                <ShieldCheck className="h-6 w-6" />
              </div>
              <div>
                <h3 className="text-sm font-semibold">No OAuth clients registered</h3>
                <p className="text-xs text-muted-foreground mt-1">
                  Register an OAuth 2.1 application to integrate external tools or test PKCE token
                  exchange.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setRegisterModalOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5" /> Register Application
              </button>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-1 lg:grid-cols-2">
              {filteredClients.map((client) => (
                <div
                  key={client.id}
                  className="rounded-lg border border-border bg-card p-5 space-y-4 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-semibold tracking-tight">{client.name}</h3>
                        <span className="rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 text-[10px] font-mono uppercase">
                          Active
                        </span>
                        <span className="rounded bg-secondary/80 px-2 py-0.5 text-[10px] font-mono text-muted-foreground">
                          {client.client_type}
                        </span>
                      </div>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        Registered {new Date(client.created_at).toLocaleString()}
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleDeleteClient(client)}
                      aria-label={`Delete ${client.name}`}
                      className="rounded p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors cursor-pointer"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>

                  <div className="space-y-2 rounded-md bg-muted/40 p-3 text-xs font-mono">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-muted-foreground text-[11px]">Client ID:</span>
                      <div className="flex items-center gap-1.5">
                        <span className="truncate max-w-[220px] text-foreground font-medium">
                          {client.client_id}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            handleCopy(client.client_id, "Client ID", `id-${client.client_id}`)
                          }
                          className="text-muted-foreground hover:text-foreground cursor-pointer"
                        >
                          {copiedKey === `id-${client.client_id}` ? (
                            <Check className="h-3.5 w-3.5 text-emerald-400" />
                          ) : (
                            <Copy className="h-3.5 w-3.5" />
                          )}
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                      Redirect URIs ({client.redirectUris.length})
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {client.redirectUris.map((uri) => (
                        <span
                          key={uri}
                          className="rounded bg-muted px-2 py-0.5 text-[11px] font-mono text-muted-foreground"
                        >
                          {uri}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-1">
                    <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                      Scopes
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {client.scopes.map((scope) => (
                        <span
                          key={scope}
                          className="rounded-full bg-primary/10 border border-primary/20 px-2 py-0.5 text-[10px] font-mono text-primary font-medium"
                        >
                          {scope}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === "pkce_simulator" && (
        <div className="rounded-lg border border-border bg-card p-6 space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-border/80 pb-4">
            <div>
              <h2 className="text-base font-semibold flex items-center gap-2">
                <Code2 className="h-5 w-5 text-primary" />
                Live OAuth 2.1 PKCE Flow (RFC 7636)
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Executes live authorization code issuance and SHA-256 verifier exchange against the
                HosteraX engine.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <select
                aria-label="Select client for PKCE flow"
                value={simSelectedClient?.client_id || ""}
                onChange={(e) => {
                  setSimSelectedClientId(e.target.value);
                  setSimStep(1);
                  setSimPkce(null);
                }}
                className="rounded-md border border-input bg-card px-2.5 py-1.5 text-xs font-mono text-foreground outline-none cursor-pointer"
              >
                {clients.map((c) => (
                  <option key={c.client_id} value={c.client_id}>
                    {c.name} ({c.client_type})
                  </option>
                ))}
              </select>
              <button
                type="button"
                data-testid="btn-start-pkce"
                onClick={startPkceFlow}
                disabled={clients.length === 0}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 cursor-pointer shadow-sm disabled:opacity-50"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Start PKCE Flow
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            {[
              { num: 1, title: "1. Generate PKCE", desc: "S256 Verifier Pair" },
              { num: 2, title: "2. Authorize", desc: "POST /api/oauth/authorize" },
              { num: 3, title: "3. Exchange Code", desc: "POST /api/oauth/token" },
              { num: 4, title: "4. Bearer Token", desc: "Server Issued Token" },
            ].map((s) => (
              <div
                key={s.num}
                className={cn(
                  "rounded-md border p-3 text-xs transition-colors",
                  simStep === s.num
                    ? "border-primary bg-primary/10 text-primary font-semibold"
                    : simStep > s.num
                      ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-400"
                      : "border-border text-muted-foreground",
                )}
              >
                <div className="font-medium">{s.title}</div>
                <div className="text-[11px] opacity-80">{s.desc}</div>
              </div>
            ))}
          </div>

          {simPkce && (
            <div className="space-y-4">
              <div className="rounded-md bg-muted/40 p-4 space-y-3 font-mono text-xs border border-border/60">
                <div>
                  <span className="text-muted-foreground">code_verifier:</span>
                  <div className="text-emerald-400 bg-background/80 p-2 rounded mt-1 truncate">
                    {simPkce.codeVerifier}
                  </div>
                </div>
                <div>
                  <span className="text-muted-foreground">code_challenge (S256):</span>
                  <div className="text-primary bg-background/80 p-2 rounded mt-1 truncate">
                    {simPkce.codeChallenge}
                  </div>
                </div>
              </div>

              {simAuthUrl && (
                <div className="rounded-md bg-muted/40 p-4 space-y-2 border border-border/60">
                  <pre className="text-[11px] font-mono text-muted-foreground bg-background/80 p-2 rounded overflow-x-auto whitespace-pre-wrap break-all">
                    {simAuthUrl}
                  </pre>
                  {simStep === 2 && (
                    <button
                      type="button"
                      disabled={simBusy}
                      data-testid="btn-oauth-authorize"
                      onClick={handleAuthorizeRequest}
                      className="mt-2 inline-flex items-center gap-1.5 rounded bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 cursor-pointer disabled:opacity-50"
                    >
                      <Check className="h-3.5 w-3.5" /> Approve &amp; Mint Auth Code
                    </button>
                  )}
                </div>
              )}

              {simAuthCode && (
                <div className="rounded-md bg-muted/40 p-4 space-y-2 border border-border/60 font-mono text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Engine Auth Code:</span>
                    <span className="text-emerald-400 font-bold">{simAuthCode}</span>
                  </div>
                  {simStep === 3 && (
                    <button
                      type="button"
                      disabled={simBusy}
                      data-testid="btn-oauth-token"
                      onClick={handleTokenExchange}
                      className="mt-2 inline-flex items-center gap-1.5 rounded bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 cursor-pointer font-sans disabled:opacity-50"
                    >
                      <KeyRound className="h-3.5 w-3.5" /> Exchange Code + Verifier for Bearer Token
                    </button>
                  )}
                </div>
              )}

              {simTokenResponse && (
                <div className="rounded-md bg-muted/40 p-4 space-y-3 border border-border/60 font-mono text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-sans font-semibold text-emerald-400">
                      Real Engine OAuth 2.1 Token Response:
                    </span>
                    <span className="rounded bg-emerald-500/15 text-emerald-400 px-2 py-0.5 text-[10px]">
                      ISSUED BY ENGINE
                    </span>
                  </div>
                  <pre className="text-[11px] text-muted-foreground bg-background/80 p-3 rounded overflow-x-auto whitespace-pre">
                    {JSON.stringify(simTokenResponse, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {activeTab === "mcp_configs" && (
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-lg border border-border bg-card p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Bot className="h-5 w-5 text-primary" />
                <h3 className="text-sm font-semibold">Claude Desktop Configuration</h3>
              </div>
            </div>
            <pre className="rounded bg-muted/60 p-3 text-[11px] font-mono text-muted-foreground overflow-x-auto whitespace-pre">
              {JSON.stringify(
                {
                  mcpServers: {
                    hosterax: {
                      command: "npx",
                      args: ["-y", "@hosterax/mcp-server"],
                      env: {
                        HOSTERAX_URL: engine.url,
                        HOSTERAX_CLIENT_ID: clients[0]?.client_id || "register-client-first",
                        HOSTERAX_SCOPES:
                          clients[0]?.scopes.join(" ") || "mcp:tools read:projects",
                      },
                    },
                  },
                },
                null,
                2,
              )}
            </pre>
          </div>

          <div className="rounded-lg border border-border bg-card p-6 space-y-4">
            <div className="flex items-center gap-2">
              <Terminal className="h-5 w-5 text-primary" />
              <h3 className="text-sm font-semibold">Cursor IDE MCP Configuration</h3>
            </div>
            <pre className="rounded bg-muted/60 p-3 text-[11px] font-mono text-muted-foreground overflow-x-auto whitespace-pre">
              {JSON.stringify(
                {
                  name: "hosterax",
                  type: "sse",
                  url: `${engine.url}/mcp/sse`,
                  headers: {
                    "X-Client-ID": clients[0]?.client_id || "register-client-first",
                  },
                },
                null,
                2,
              )}
            </pre>
          </div>
        </div>
      )}

      {registerModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm">
          <div className="w-full max-w-xl rounded-lg border border-border bg-card p-6 shadow-xl space-y-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-border/80 pb-3">
              <h2 className="text-base font-semibold flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-primary" />
                Register New OAuth 2.1 Application
              </h2>
              <button
                type="button"
                onClick={() => setRegisterModalOpen(false)}
                className="text-xs text-muted-foreground hover:text-foreground cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="flex flex-wrap gap-2">
              {OAUTH_PRESET_TEMPLATES.map((tmpl) => (
                <button
                  key={tmpl.id}
                  type="button"
                  onClick={() => applyTemplate(tmpl)}
                  className="rounded border border-border bg-muted/30 px-2.5 py-1 text-xs text-foreground hover:border-primary/50"
                >
                  {tmpl.name}
                </button>
              ))}
            </div>

            <form onSubmit={handleCreateClient} className="space-y-4">
              <div>
                <label
                  htmlFor={modalAppNameId}
                  className="block text-xs font-medium text-foreground"
                >
                  Application Name *
                </label>
                <input
                  id={modalAppNameId}
                  type="text"
                  required
                  value={newAppName}
                  onChange={(e) => setNewAppName(e.target.value)}
                  placeholder="e.g. Claude Desktop or CI/CD Deployer"
                  className="mt-1 w-full rounded-md border border-input bg-background px-3 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setNewClientType("public")}
                  className={cn(
                    "rounded-lg border p-3 text-left transition-colors cursor-pointer",
                    newClientType === "public"
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-background text-muted-foreground",
                  )}
                >
                  <div className="text-xs font-semibold">Public (PKCE)</div>
                  <div className="text-[11px] opacity-80 mt-0.5">Desktop apps &amp; SPAs</div>
                </button>

                <button
                  type="button"
                  onClick={() => setNewClientType("confidential")}
                  className={cn(
                    "rounded-lg border p-3 text-left transition-colors cursor-pointer",
                    newClientType === "confidential"
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-background text-muted-foreground",
                  )}
                >
                  <div className="text-xs font-semibold">Confidential</div>
                  <div className="text-[11px] opacity-80 mt-0.5">Backend / CI services</div>
                </button>
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor={modalRedirectInputId}
                  className="block text-xs font-medium text-foreground"
                >
                  Allowed Redirect URIs *
                </label>
                <div className="flex gap-2">
                  <input
                    id={modalRedirectInputId}
                    type="text"
                    value={tempRedirectUri}
                    onChange={(e) => setTempRedirectUri(e.target.value)}
                    placeholder="http://localhost:3000/callback"
                    className="flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-xs font-mono"
                  />
                  <button
                    type="button"
                    onClick={handleAddRedirectUri}
                    className="rounded bg-secondary px-3 py-1.5 text-xs font-medium"
                  >
                    Add
                  </button>
                </div>
                {redirectError && <p className="text-[11px] text-destructive">{redirectError}</p>}
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {newRedirectUris.map((uri) => (
                    <span
                      key={uri}
                      className="inline-flex items-center gap-1 rounded bg-muted px-2 py-0.5 text-[11px] font-mono text-muted-foreground"
                    >
                      {uri}
                      <button
                        type="button"
                        onClick={() =>
                          setNewRedirectUris(newRedirectUris.filter((u) => u !== uri))
                        }
                      >
                        ✕
                      </button>
                    </span>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-40 overflow-y-auto border border-border/60 rounded-md p-2 bg-background/50">
                {AVAILABLE_OAUTH_SCOPES.map(({ scope, label }) => {
                  const checked = selectedScopes.includes(scope);
                  return (
                    <label
                      key={scope}
                      className={cn(
                        "flex items-start gap-2 p-1.5 rounded cursor-pointer text-xs",
                        checked ? "bg-primary/10 text-foreground" : "text-muted-foreground",
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) =>
                          setSelectedScopes(
                            e.target.checked
                              ? [...selectedScopes, scope]
                              : selectedScopes.filter((s) => s !== scope),
                          )
                        }
                      />
                      <div className="min-w-0">
                        <div className="font-medium text-[11px] text-foreground">{label}</div>
                        <div className="text-[10px] text-muted-foreground font-mono">{scope}</div>
                      </div>
                    </label>
                  );
                })}
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-border/80">
                <button
                  type="button"
                  onClick={() => setRegisterModalOpen(false)}
                  className="rounded px-3 py-1.5 text-xs text-muted-foreground"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground"
                >
                  Create Application
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {secretModalData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-lg border border-emerald-500/30 bg-card p-6 shadow-xl space-y-4">
            <div className="flex items-center gap-2 text-emerald-400">
              <KeyRound className="h-5 w-5" />
              <h2 className="text-base font-semibold text-foreground">
                Client Secret Generated for {secretModalData.appName}
              </h2>
            </div>
            <div className="rounded-md bg-amber-500/10 border border-amber-500/20 p-3 text-xs text-amber-300 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>Copy this secret now — it is hashed at rest and won&apos;t be shown again.</span>
            </div>
            <div className="space-y-2 font-mono text-xs">
              <div className="bg-muted/60 p-2 rounded truncate">
                Client ID: {secretModalData.clientId}
              </div>
              <div className="bg-muted/60 p-2 rounded text-emerald-400 font-bold truncate">
                Client Secret: {secretModalData.clientSecret}
              </div>
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setSecretModalData(null)}
                className="rounded bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
