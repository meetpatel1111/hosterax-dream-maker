import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/local")({
  beforeLoad: () => {
    throw redirect({ to: "/dashboard" });
  },
});
