import { ledgerRows, reviewRows, agentRows } from "@/lib/server/cockpit";
import { Cockpit } from "./cockpit-app";
import { requireOpsPage } from "@/lib/server/ops-page";

export const dynamic = "force-dynamic";
export const metadata = { title: "DockClock cockpit" };

/** Ops cockpit: AG Grid Enterprise ledgers (PLAN §7.1). Reconciliation loads on its tab (it calls PayPal). */
export default async function CockpitPage() {
  await requireOpsPage("/cockpit");
  const [ledger, review, agents] = await Promise.all([ledgerRows(), reviewRows(), agentRows()]);
  return <Cockpit ledger={ledger} review={review} agents={agents} licenseKey={process.env.AG_GRID_LICENSE_KEY} />;
}
