import { createFileRoute } from "@tanstack/react-router";
import { SecretsVaultManager } from "@/components/hx/secrets-vault-manager";

export const Route = createFileRoute("/_app/vault")({
  head: () => ({
    meta: [
      { title: "Secrets Vault & Encrypted Groups — HosteraX" },
      {
        name: "description",
        content:
          "Centralized environment variables and encrypted secret groups for multi-service microservices and stacks.",
      },
    ],
  }),
  component: VaultPage,
});

function VaultPage() {
  return (
    <div className="w-full max-w-[1720px] 2xl:max-w-none mx-auto space-y-6 transition-all duration-300">
      <SecretsVaultManager />
    </div>
  );
}
