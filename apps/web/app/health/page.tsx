import { health } from "@/lib/server/health";

export const dynamic = "force-dynamic";
export const metadata = { title: "DockClock health" };

const ago = (iso: string | null, now: number) => (iso ? `${Math.max(0, Math.round((now - Date.parse(iso)) / 60_000))} min ago` : "never");

/** Judge-mode health page (PLAN §7.4): queue depth, worker heartbeat and the last cron run. Counts only. */
export default async function HealthPage() {
  const h = await health().catch(() => null);
  const now = Date.now();
  if (!h) return <main style={{ padding: 24, fontFamily: "system-ui" }}><h1>DockClock health</h1><p>Database unreachable.</p></main>;
  const rows: [string, string | number][] = [
    ["Queue depth", h.queue.total], ["Captured, payout pending", h.queue.awaitingPayout], ["Settling", h.queue.settling],
    ["Needs human review", h.queue.review], ["Disputed", h.queue.disputed], ["Open offers", h.queue.openOffers],
    ["Worker", h.worker.mode], ["Last worker tick", ago(h.worker.lastTickAt, now)], ["Last tick took", `${h.worker.lastTickMs} ms`],
    ["Last worker error", h.worker.lastError ?? "none"], ["Last reconcile (cron)", ago(h.cron.lastReconcileAt, now)],
    ["Last PayPal webhook", ago(h.lastWebhookAt, now)], ["Database round trip", `${h.dbMs} ms`],
  ];
  return (
    <main style={{ padding: 24, fontFamily: "system-ui, sans-serif", maxWidth: 640, color: "#1F2328" }}>
      <h1 style={{ fontSize: 24, margin: "0 0 12px" }}>DockClock health</h1>
      <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 15 }}>
        <tbody>{rows.map(([k, v]) => <tr key={k} style={{ borderBottom: "1px solid #D7DBD6" }}><th scope="row" style={{ textAlign: "left", padding: "8px 12px 8px 0", fontWeight: 500, color: "#5B636B" }}>{k}</th><td style={{ padding: "8px 0", fontVariantNumeric: "tabular-nums" }}>{v}</td></tr>)}</tbody>
      </table>
    </main>
  );
}
