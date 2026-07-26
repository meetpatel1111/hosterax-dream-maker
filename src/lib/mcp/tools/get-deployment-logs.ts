import { createClient } from "@supabase/supabase-js";
import { defineTool, type ToolContext } from "@lovable.dev/mcp-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";

function supabaseAsUser(ctx: ToolContext) {
  return createClient<Database>(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    global: { headers: { Authorization: `Bearer ${ctx.getToken()}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export default defineTool({
  name: "get_deployment_logs",
  title: "Get deployment logs",
  description: "Return log lines for a specific deployment.",
  inputSchema: {
    deployment_id: z.string().uuid().describe("Deployment UUID (from list_deployments)."),
    limit: z.number().int().min(1).max(500).optional().describe("Max lines (default 200)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ deployment_id, limit }, ctx) => {
    if (!ctx.isAuthenticated()) return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    const { data, error } = await supabaseAsUser(ctx)
      .from("deployment_logs")
      .select("level, message, created_at")
      .eq("deployment_id", deployment_id)
      .order("created_at", { ascending: true })
      .limit(limit ?? 200);
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    const text = (data ?? []).map((r) => `[${r.level}] ${r.message}`).join("\n");
    return {
      content: [{ type: "text", text: text || "(no logs)" }],
      structuredContent: { logs: data ?? [] },
    };
  },
});
