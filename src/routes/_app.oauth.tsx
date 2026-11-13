import { createFileRoute } from "@tanstack/react-router";
import { OAuthStudio } from "@/components/hx/oauth-studio";

export const Route = createFileRoute("/_app/oauth")({
  head: () => ({
    meta: [
      { title: "OAuth 2.1 & MCP Client Registry — HosteraX" },
      {
        name: "description",
        content:
          "Register and manage OAuth 2.1 applications, PKCE flow verifications, and Model Context Protocol (MCP) clients.",
      },
    ],
  }),
  component: OAuthPage,
});

function OAuthPage() {
  return <OAuthStudio />;
}
