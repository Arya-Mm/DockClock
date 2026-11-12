import { health } from "@/lib/server/health";
import { OpsShell } from "../ops-shell";

export const dynamic = "force-dynamic";
export const metadata = { title: "DockClock health" };

const ago = (iso: string | null, now: number) => (iso ? `${Math.max(0, Math.round((now - Date.parse(iso)) / 60_000))} min ago` : "never");

/** Judge-mode health page (PLAN §7.4): queue depth, worker heartbeat and the last cron run. Counts only. */
export default async function HealthPage() {
  const h = await health().catch(() => null);
  const now = Date.now();
  if (!h) return <OpsShell active="/health" title="Health"><div className="op-card"><h2>Database unreachable</h2><p className="op-mute">Check DATABASE_URL and the Neon status page.</p></div></OpsShell>;
  const rows: [string, string | number][] = [
    ["Queue depth", h.queue.total], ["Captured, payout pending", h.queue.awaitingPayout], ["Settling", h.queue.settling],
    ["Needs human review", h.queue.review], ["Disputed", h.queue.disputed], ["Open offers", h.queue.openOffers],
    ["Worker", h.worker.mode], ["Last worker tick", ago(h.worker.lastTickAt, now)], ["Last tick took", `${h.worker.lastTickMs} ms`],
    ["Last worker error", h.worker.lastError ?? "none"], ["Last reconcile (cron)", ago(h.cron.lastReconcileAt, now)],
    ["Last PayPal webhook", ago(h.lastWebhookAt, now)], ["Database round trip", `${h.dbMs} ms`],
  ];
  return (
    <OpsShell active="/health" title="Health" sub="Queue depth, worker heartbeat and the last cron run. Counts and times only.">
      <section className="op-card">
        <table className="op-table">
          <tbody>{rows.map(([k, v]) => <tr key={k}><th scope="row">{k}</th><td className="op-num">{v}</td></tr>)}</tbody>
        </table>
      </section>
    </OpsShell>
  );
}
