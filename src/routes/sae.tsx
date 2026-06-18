import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/sae")({
  component: () => <Outlet />,
  head: () => ({ meta: [{ title: "SAE — Suivi de tournée" }] }),
});
