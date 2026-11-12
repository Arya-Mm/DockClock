import { ledgerRows, reviewRows, agentRows } from "@/lib/server/cockpit";
import { Cockpit } from "./cockpit-app";
import { requireOpsPage } from "@/lib/server/ops-page";
import { AppShell } from "@/components/app-shell";

export const dynamic = "force-dynamic";
export const metadata = { title: "DockClock cockpit" };

/** Ops cockpit: AG Grid Enterprise ledgers (PLAN §7.1). Reconciliation loads on its tab (it calls PayPal). */
export default async function CockpitPage() {
  await requireOpsPage("/cockpit");
  const [ledger, review, agents] = await Promise.all([ledgerRows(), reviewRows(), agentRows()]);
  return (
    <AppShell title="Cockpit" sub="AG Grid Enterprise ledgers. The approve cell in the review queue runs a real PayPal capture.">
      <div className="h-[calc(100svh-9rem)] min-h-[560px] overflow-hidden rounded-xl bg-white text-black ring-1 ring-foreground/10"><Cockpit ledger={ledger} review={review} agents={agents} licenseKey={process.env.AG_GRID_LICENSE_KEY} /></div>
    </AppShell>
  );
}
