import Link from "next/link";
import { judgeData } from "@/lib/server/judge";
import "./judge.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "DockClock judge mode" };

const usd = (c: number) => `$${(c / 100).toFixed(2)}`;
const stepText = (s: { do: string } & Record<string, unknown>) =>
  [s.do, typeof s.cents === "number" ? usd(s.cents) : "", typeof s.event === "string" ? s.event : "", typeof s.reason === "string" ? s.reason : "", typeof s.message === "string" ? s.message : ""].filter(Boolean).join(" · ");
const t = (iso: string) => new Date(iso).toISOString().replace("T", " ").slice(0, 16) + " UTC";

/** Judge mode (PLAN §8): eight scenarios with engine plans and the real sandbox calls behind them, plus the red-team log. */
export default async function JudgePage() {
  const d = await judgeData();
  return (
    <main className="jg">
      <header className="jg-head">
        <h1>DockClock judge mode</h1>
        <p>A PayPal authorization hold is a spending mandate for an AI agent. The AI reads, code decides, PayPal executes.</p>
        <p className="jg-mute">PayPal sandbox only. Engine plans run on a simulated clock; live rows are real sandbox calls with their <code>debug_id</code>.</p>
        <nav className="jg-nav" aria-label="Live surfaces">
          <Link href="/dispatch">Dispatch</Link><Link href="/dock">Dock board</Link><Link href="/driver">Driver app</Link>
          <Link href="/cockpit">Cockpit</Link><Link href="/dashboard">Studio analytics</Link><Link href="/verify">Verify a receipt</Link><Link href="/health">Health</Link>
        </nav>
      </header>

      <section aria-labelledby="sc">
        <h2 id="sc">Scenarios</h2>
        <ol className="jg-list">
          {d.scenarios.map((s) => (
            <li key={s.id} className="jg-card">
              <div className="jg-card-head">
                <h3>{s.n}. {s.title}</h3>
                <Link className="jg-try" href={s.tryAt.href}>Try it: {s.tryAt.label}</Link>
              </div>
              <p>{s.story}</p>
              {s.engine && (
                <div className="jg-plan">
                  <p><b>Engine plan:</b> {s.engine.plan.action}, dwell {s.engine.plan.dwellMin} min, billable {s.engine.plan.billableMin} min, charge {usd(s.engine.plan.chargeCents)}, capture {usd(s.engine.plan.captureCents)}{s.engine.plan.invoiceCents ? `, invoice ${usd(s.engine.plan.invoiceCents)}` : ""}</p>
                  <p><b>PayPal steps:</b> {s.engine.steps.map((x) => stepText(x as { do: string } & Record<string, unknown>)).join("  →  ")}</p>
                  {s.engine.notes.length > 0 && <p className="jg-mute">{s.engine.notes.join(" · ")}</p>}
                  <details><summary>Audit trail</summary><ul>{s.engine.plan.audit.map((a, i) => <li key={i}>{a}</li>)}</ul></details>
                </div>
              )}
              {s.agentic && <ul className="jg-agentic">{s.agentic.map((a) => <li key={a}>{a}</li>)}</ul>}
              <div className="jg-live">
                <p className="jg-mute">{s.liveNote}</p>
                {s.live.length > 0 && (
                  <table>
                    <thead><tr><th>When</th><th>Call</th><th>Amount</th><th>PayPal id</th><th>debug_id</th></tr></thead>
                    <tbody>{s.live.map((o) => <tr key={`${o.operation}${o.at}${o.paypalId}`}><td>{t(o.at)}</td><td>{o.operation}</td><td>{o.usd === null ? "" : `$${o.usd.toFixed(2)}`}</td><td><code>{o.paypalId}</code></td><td><code>{o.debugId}</code></td></tr>)}</tbody>
                  </table>
                )}
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="rt" className="jg-card">
        <h2 id="rt">Red team: what the mandate guard refused</h2>
        <p className="jg-mute">Guard verdicts so far: {Object.entries(d.verdicts).map(([k, v]) => `${k} ${v}`).join(", ")}. Every row is in the hash-chained agent ledger.</p>
        <table>
          <thead><tr><th>#</th><th>Agent</th><th>Action</th><th>Verdict</th><th>Reason</th></tr></thead>
          <tbody>{d.redTeam.map((r) => <tr key={r.seq}><td>{r.seq}</td><td>{r.agent}</td><td>{r.action}</td><td className={r.verdict === "BLOCKED" ? "jg-bad" : "jg-warn"}>{r.verdict}</td><td>{r.reasons}</td></tr>)}</tbody>
        </table>
      </section>

      <section aria-labelledby="wh" className="jg-card">
        <h2 id="wh">Latest PayPal webhooks</h2>
        <table>
          <thead><tr><th>When</th><th>Event</th><th>Processed</th></tr></thead>
          <tbody>{d.webhooks.map((w) => <tr key={w.type + w.at}><td>{t(w.at)}</td><td>{w.type}</td><td>{w.processed ? "yes" : "queued"}</td></tr>)}</tbody>
        </table>
      </section>
    </main>
  );
}
