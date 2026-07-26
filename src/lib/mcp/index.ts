import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listProjects from "./tools/list-projects";
import listDeployments from "./tools/list-deployments";
import getDeploymentLogs from "./tools/get-deployment-logs";

// Direct Supabase host is required as the OAuth issuer (mcp-js verifies the
// discovery document's `issuer`; the .lovable.cloud proxy fails RFC 8414).
const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "hosterax-mcp",
  title: "HosteraX",
  version: "0.1.0",
  instructions:
    "Read-only access to the signed-in user's HosteraX projects, deployments, and deployment logs.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [listProjects, listDeployments, getDeploymentLogs],
});
