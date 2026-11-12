import Link from "next/link";
import { controlData } from "@/lib/server/control";
import { requireOpsPage } from "@/lib/server/ops-page";
import { KillSwitch, LiveRefresh, Reissue, ResetDemo } from "./actions";
import "./control.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "DockClock control room" };

const usd = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const ago = (iso: string | null, now: number) => { if (!iso) return "never"; const m = Math.round((now - Date.parse(iso)) / 60_000); return m < 1 ? "just now" : m < 90 ? `${m} min ago` : `${Math.round(m / 60)} h ago`; };
const hhmm = (iso: string) => new Date(iso).toISOString().slice(11, 16) + " UTC";

// Load lifecycle in order (core ledger state machine); the pipeline bar follows it.
const PIPE: [string, string, string][] = [
  ["DISPATCHED", "Dispatched", "Load created, no hold yet"], ["AWAITING_PAYER", "Awaiting payer", "Waiting for the shipper to approve the PayPal hold"],
  ["AUTHORIZED", "Hold placed", "PayPal authorization in place"], ["AT_FACILITY", "At the dock", "Arrived; the wait clock is running"],
  ["DEPARTED", "Departed", "Left the geofence; settlement is next"], ["NEEDS_REVIEW", "Needs review", "Evidence too weak: a human decides before money moves"],
  ["SETTLING", "Settling", "Executor is calling PayPal"], ["CAPTURED", "Captured", "Money captured; payout pending"],
  ["PAID_OUT", "Paid out", "Driver paid"], ["VOIDED", "Voided", "Nothing owed; hold released"],
  ["INVOICED_SPILLOVER", "Invoiced", "Above the hold: the rest was invoiced"], ["DISPUTED", "Disputed", "Shipper opened a dispute; evidence submitted"],
];

/** Control room: the whole system on one screen for an operator (ops key required). Every number is a database or PayPal record. */
export default async function ControlPage() {
  await requireOpsPage("/control");
  const d = await controlData();
  const now = Date.now();
  const totalLoads = Object.values(d.pipeline).reduce((a, b) => a + b, 0);
  const blocked = (d.verdicts24h.BLOCKED ?? 0) + (d.verdicts24h.ESCALATED ?? 0);
  return (
    <main className="cr">
      <header className="cr-top">
        <div className="cr-title"><b>DockClock</b><span>Control room</span></div>
        <div className="cr-status">
          <span className="cr-chip" title="PayPal environment the app is locked to"><i className="cr-dot cr-dot-on" />PayPal sandbox</span>
          <span className="cr-chip" title="Hash chain over every agent action; a rewritten row breaks it"><i className={d.chainOk ? "cr-dot cr-dot-on" : "cr-dot cr-dot-bad"} />Ledger chain {d.chainOk ? "verified" : "BROKEN"}</span>
          <LiveRefresh />
          <ResetDemo />
        </div>
      </header>

      <nav className="cr-nav" aria-label="Surfaces">
        {[["/judge", "Judge"], ["/dispatch", "Dispatch"], ["/dock", "Dock board"], ["/cockpit", "Cockpit"], ["/dashboard", "Analytics"], ["/verify", "Verify"], ["/health", "Health"]].map(([h, l]) => <Link key={h} href={h!}>{l}</Link>)}
      </nav>

      <section className="cr-kpis" aria-label="Money moved in the sandbox">
        <div title="Sum of successful PayPal captures (settlements and accepted offers)"><span>Captured</span><b>{usd(d.kpi.capturedCents)}</b><small>{d.kpi.captures} captures</small></div>
        <div title="Sum of successful PayPal payouts to drivers and carriers"><span>Paid to drivers</span><b>{usd(d.kpi.paidOutCents)}</b><small>{d.kpi.payouts} payouts</small></div>
        <div title="PayPal authorizations placed (approved by the payer or from the vault)"><span>Holds placed</span><b>{d.kpi.holdsPlaced}</b><small>authorizations</small></div>
        <div title="Loads with work waiting: payout pending, settling, review, disputes, open offers"><span>Queue depth</span><b>{d.health.queue.total}</b><small>{d.health.queue.review} need review</small></div>
        <div title="Agent actions the mandate guard refused or sent to a human in the last 24 h"><span>Guard refusals (24 h)</span><b className={blocked ? "cr-warn" : ""}>{blocked}</b><small>{d.verdicts24h.ALLOWED ?? 0} allowed</small></div>
        <div title="Dispute evidence packs submitted to PayPal"><span>Disputes defended</span><b>{d.kpi.evidence}</b><small>evidence packs</small></div>
      </section>

      <section className="cr-panel" aria-labelledby="pipe">
        <h2 id="pipe">Load pipeline <small>real loads by state</small></h2>
        <div className="cr-bar" role="img" aria-label="Share of loads in each state">
          {PIPE.filter(([k]) => d.pipeline[k]).map(([k, l, tip]) => <span key={k} className={`cr-seg cr-s-${k}`} style={{ flexGrow: d.pipeline[k] }} title={`${l}: ${d.pipeline[k]} (${tip})`} />)}
        </div>
        <ul className="cr-legend">{PIPE.map(([k, l, tip]) => <li key={k} title={tip}><i className={`cr-s-${k}`} />{l}<b>{d.pipeline[k] ?? 0}</b></li>)}</ul>
        <p className="cr-mute">{totalLoads} real loads. Offers: {Object.entries(d.offers).map(([k, v]) => `${v} ${k.toLowerCase()}`).join(", ") || "none"}.</p>
      </section>

      <div className="cr-grid">
        <section className="cr-panel" aria-labelledby="pp">
          <h2 id="pp">PayPal feed <small>latest calls with debug_id</small></h2>
          <table>
            <thead><tr><th>Time</th><th>Call</th><th className="cr-num">Amount</th><th>Status</th><th>debug_id</th></tr></thead>
            <tbody>{d.ops.map((o) => (
              <tr key={o.at + o.op + o.paypalId}>
                <td>{hhmm(o.at)}</td><td title={o.paypalId ? `PayPal id ${o.paypalId}${o.loadId ? `, load ${o.loadId}` : ""}` : undefined}>{o.op}</td>
                <td className="cr-num">{o.usd === null ? "" : `$${o.usd.toFixed(2)}`}</td>
                <td><span className={`cr-tag cr-tag-${o.status}`}>{o.status.toLowerCase()}</span></td><td><code>{o.debugId ?? ""}</code></td>
              </tr>))}</tbody>
          </table>
        </section>

        <section className="cr-panel" aria-labelledby="sys">
          <h2 id="sys">System <small>free-tier deploy</small></h2>
          <dl className="cr-sys">
            <div title="Worker jobs: capture and payout polls, reauth watchdog, offer expiry, evidence retry"><dt>Worker</dt><dd>{d.health.worker.mode}, last tick {ago(d.health.worker.lastTickAt, now)}{d.health.worker.lastTickAt ? ` (${d.health.worker.lastTickMs} ms)` : ""}</dd></div>
            <div><dt>Worker error</dt><dd className={d.health.worker.lastError ? "cr-warn" : ""}>{d.health.worker.lastError ?? "none"}</dd></div>
            <div title="Nightly reconcile against PayPal Transaction Search (GitHub Actions cron)"><dt>Reconcile</dt><dd>{ago(d.health.cron.lastReconcileAt, now)}</dd></div>
            <div title="Last PayPal webhook received (signature verified, deduped by event id)"><dt>Last webhook</dt><dd>{ago(d.health.lastWebhookAt, now)}</dd></div>
            <div><dt>Database</dt><dd>{d.health.dbMs} ms round trip</dd></div>
            <div title="Captured with payout still pending, disputed, and open offers"><dt>Waiting</dt><dd>{d.health.queue.awaitingPayout} payout, {d.health.queue.disputed} disputed, {d.health.queue.openOffers} open offers</dd></div>
          </dl>
          <h3>Recent loads</h3>
          <table>
            <thead><tr><th>Load</th><th>Facility</th><th>State</th><th className="cr-num">Hold</th></tr></thead>
            <tbody>{d.loads.map((l) => <tr key={l.id}><td title={`${l.carrier}, updated ${ago(l.updatedAt, now)}`}><code>{l.id}</code></td><td>{l.facility}</td><td><span className={`cr-tag cr-s-${l.state}`}>{l.state.replaceAll("_", " ").toLowerCase()}</span></td><td className="cr-num">{l.holdUsd ? `$${l.holdUsd.toFixed(2)}` : ""}</td></tr>)}</tbody>
          </table>
        </section>
      </div>

      <section className="cr-panel" aria-labelledby="md">
        <h2 id="md">Agent mandates <small>the kill switch</small></h2>
        <p className="cr-mute">An agent can only spend inside its mandate. Revoking it stops the agent at accept and again at execution. The newest mandate per agent is the one in force.</p>
        <table>
          <thead><tr><th>Agent</th><th>Mandate</th><th>Allowed actions</th><th className="cr-num">Per action</th><th className="cr-num">Per day</th><th>Status</th><th /></tr></thead>
          <tbody>{d.mandates.map((m) => (
            <tr key={m.id} className={m.revokedAt ? "cr-row-off" : undefined}>
              <td><b>{m.agent.replaceAll("_", " ").toLowerCase()}</b></td><td><code>{m.id}</code></td><td>{m.actions}</td>
              <td className="cr-num">${m.perActionUsd.toFixed(2)}</td><td className="cr-num">${m.dailyUsd.toFixed(2)}</td>
              <td>{m.revokedAt ? <span className="cr-tag cr-tag-FAILED" title={`Revoked ${ago(m.revokedAt, now)}`}>revoked</span> : m.expired ? <span className="cr-tag">expired</span> : <span className="cr-tag cr-tag-SUCCEEDED">active</span>}</td>
              <td>{m.revokedAt ? <Reissue id={m.id} agent={m.agent} /> : !m.expired && <KillSwitch id={m.id} agent={m.agent} />}</td>
            </tr>))}</tbody>
        </table>
      </section>
    </main>
  );
}
