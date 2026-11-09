import { createFileRoute } from "@tanstack/react-router";
import { DisasterRecoveryHub } from "@/components/hx/disaster-recovery-hub";

export const Route = createFileRoute("/_app/backups")({
  head: () => ({
    meta: [
      { title: "Disaster Recovery & Multi-Cloud Backups — HosteraX" },
      {
        name: "description",
        content:
          "Automated database snapshots, SHA-256 verification, S3/Cloudflare R2 multi-cloud sync, and sandbox restore drills.",
      },
    ],
  }),
  component: BackupsPage,
});

function BackupsPage() {
  return (
    <div className="w-full max-w-[1720px] 2xl:max-w-none mx-auto space-y-6 transition-all duration-300">
      <DisasterRecoveryHub />
    </div>
  );
}
