import { notFound } from "next/navigation";

import { isGod } from "@acme/api/operator";

import { getSession } from "~/auth/server";
import { AdminWorkspacesView } from "./_components/admin-workspaces-view";

// God-mode support console. Operator status is checked server-side and a
// non-operator gets a plain 404 (notFound) — the route must not reveal that it
// exists, and the operator.workspaceDetail query is independently operator-gated.
export default async function AdminWorkspacesPage() {
  const session = await getSession();
  if (!session || !isGod(session.user.email)) {
    notFound();
  }
  return <AdminWorkspacesView />;
}
