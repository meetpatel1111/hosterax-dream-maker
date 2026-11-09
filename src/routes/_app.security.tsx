import { createFileRoute } from "@tanstack/react-router";
import { FleetSecurityHub } from "@/components/hx/fleet-security-hub";

export const Route = createFileRoute("/_app/security")({
  head: () => ({
    meta: [
      { title: "Container Security & CVE Defense — HosteraX" },
      {
        name: "description",
        content:
          "Fleet-wide container image CVE scanner, real-time NIST NVD intelligence, CycloneDX v1.5 SBOM generator, and Zero-Trust deployment policy gates.",
      },
    ],
  }),
  component: SecurityPage,
});

function SecurityPage() {
  return (
    <div className="w-full max-w-[1720px] 2xl:max-w-none mx-auto space-y-6 transition-all duration-300">
      <FleetSecurityHub />
    </div>
  );
}
