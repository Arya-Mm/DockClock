"use client";
// Geofence simulator: builds an ELD ping trace for a scenario, lets you scrub through time, and streams the pings
// up to the cursor to /api/loads/<id>/pings. The server derives arrival/departure; exit settles the stop.
import { useMemo, useState } from "react";

interface Fac { name: string; lat: number; lng: number; radiusM: number }
interface Ping { tMs: number; lat: number; lng: number; source: string }
type Scenario = "normal" | "fuel" | "reentry" | "spoof";
const SCENARIOS: Record<Scenario, string> = {
  normal: "Normal visit",
  fuel: "Fuel run, back in 15 min (same visit)",
  reentry: "Leaves 45 min, comes back (new visit)",
  spoof: "Spoofed GPS teleport (rejected)",
};
const MIN = 60_000;
const M_PER_DEG_LAT = 111_320;

/** Point n metres north and e metres east of the facility. */
function offset(f: Fac, n: number, e: number) {
  return { lat: f.lat + n / M_PER_DEG_LAT, lng: f.lng + e / (M_PER_DEG_LAT * Math.cos((f.lat * Math.PI) / 180)) };
}

function buildTrace(s: Scenario, f: Fac, arriveMs: number, departMs: number): Ping[] {
  const pts: Ping[] = [];
  const add = (t: number, n: number, e: number) => pts.push({ tMs: Math.round(t), ...offset(f, n, e), source: "ELD-SIM" });
  // Approach from 2 km south in 4 steps, 5 min apart.
  for (let i = 4; i >= 1; i--) add(arriveMs - i * 5 * MIN, -i * 500, 0);
  // Parked in the yard: deterministic jitter (same on server and client render), well inside the fence.
  const inside = (from: number, to: number) => { for (let t = from; t <= to; t += 10 * MIN) add(t, Math.sin(t / 7e5) * 40, Math.cos(t / 9e5) * 40); };
  if (s === "fuel" || s === "reentry") {
    const mid = arriveMs + (departMs - arriveMs) / 2, away = s === "fuel" ? 15 * MIN : 45 * MIN;
    inside(arriveMs, mid);
    add(mid + 5 * MIN, 1_500, 0);
    add(mid + away - 5 * MIN, 1_500, 0);
    inside(mid + away, departMs);
  } else inside(arriveMs, departMs);
  if (s === "spoof") add(arriveMs + 30 * MIN + 1_000, 80_000, 0); // 80 km away one second later: impossible speed
  for (let i = 1; i <= 3; i++) add(departMs + i * 5 * MIN, i * 600, 0);
  return pts.sort((a, b) => a.tMs - b.tMs);
}

export function SimApp({ loadId, driverKey, facility, arrivalMs, nowMs, state }: { loadId: string; driverKey: string; facility: Fac; arrivalMs: number | null; nowMs: number; state: string }) {
  const [scenario, setScenario] = useState<Scenario>("normal");
  const arrive = arrivalMs ?? nowMs - 170 * MIN;
  const depart = Math.max(arrive + 30 * MIN, nowMs - 16 * MIN); // last exit ping lands about now
  const trace = useMemo(() => buildTrace(scenario, facility, arrive, depart), [scenario, facility, arrive, depart]);
  const t0 = trace[0]!.tMs, t1 = trace[trace.length - 1]!.tMs;
  const [cursor, setCursor] = useState(t1);
  const [result, setResult] = useState("");
  const [busy, setBusy] = useState(false);
  const at = Math.min(Math.max(cursor, t0), t1);
  const sent = trace.filter((p) => p.tMs <= at);

  // Plan view: 4 km square centred on the facility, north up.
  const SPAN = 4_000, W = 320;
  const xy = (p: { lat: number; lng: number }) => {
    const n = (p.lat - facility.lat) * M_PER_DEG_LAT, e = (p.lng - facility.lng) * M_PER_DEG_LAT * Math.cos((facility.lat * Math.PI) / 180);
    return { x: Math.min(W, Math.max(0, W / 2 + (e / SPAN) * W)), y: Math.min(W, Math.max(0, W / 2 - (n / SPAN) * W)) };
  };
  const r = (facility.radiusM / SPAN) * W;
  const path = sent.map((p, i) => { const q = xy(p); return `${i ? "L" : "M"}${q.x.toFixed(1)},${q.y.toFixed(1)}`; }).join(" ");
  const last = sent.length ? xy(sent[sent.length - 1]!) : null;

  async function stream() {
    setBusy(true); setResult("");
    try {
      const res = await fetch(`/api/loads/${encodeURIComponent(loadId)}/pings?k=${encodeURIComponent(driverKey)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pings: sent }) });
      const j = (await res.json()) as { data?: { accepted: boolean; issues: string[]; settled: { plan: { action: string; captureCents: number; driverPayoutCents: number } } | null }; error?: { message: string } };
      if (!j.data) setResult(j.error?.message ?? `HTTP ${res.status}`);
      else {
        const d = j.data;
        setResult([d.accepted ? "Trace accepted." : "Trace rejected.", ...d.issues,
          d.settled ? `Settled: ${d.settled.plan.action}, captured $${(d.settled.plan.captureCents / 100).toFixed(2)}, driver $${(d.settled.plan.driverPayoutCents / 100).toFixed(2)}` : "Not settled (no departure yet)."].join("\n"));
      }
    } catch (e) { setResult((e as Error).message); }
    finally { setBusy(false); }
  }

  const fmt = (ms: number) => new Date(ms).toISOString().slice(11, 16) + " UTC";
  return (
    <main className="rd-wrap">
      <header className="rd-top"><span className="rd-brand">Geofence simulator</span><span className="rd-muted">{loadId}, {state.toLowerCase()}</span></header>
      <label className="rd-muted" htmlFor="sim-scn">Scenario</label>
      <select id="sim-scn" className="rd-lang" value={scenario} onChange={(e) => { setScenario(e.target.value as Scenario); setResult(""); }}>
        {(Object.keys(SCENARIOS) as Scenario[]).map((s) => <option key={s} value={s}>{SCENARIOS[s]}</option>)}
      </select>
      <svg viewBox={`0 0 ${W} ${W}`} role="img" aria-label={`Truck path around ${facility.name}`} style={{ width: "100%", background: "#22262a", borderRadius: 16 }}>
        <circle cx={W / 2} cy={W / 2} r={r} fill="#00573f55" stroke="#ffffff" strokeWidth={2} />
        <text x={W / 2} y={W / 2 + r + 16} textAnchor="middle" fill="#c9ced3" fontSize={12}>{facility.name} ({facility.radiusM} m fence)</text>
        <path d={path} fill="none" stroke="#ffd200" strokeWidth={2.5} strokeLinejoin="round" />
        {last && <circle cx={last.x} cy={last.y} r={7} fill="#ffd200" stroke="#2b2f33" strokeWidth={2} />}
      </svg>
      <label htmlFor="sim-t">Stream pings up to <strong>{fmt(at)}</strong> ({sent.length} of {trace.length})</label>
      <input id="sim-t" type="range" min={t0} max={t1} step={MIN} value={at} onChange={(e) => setCursor(Number(e.target.value))} style={{ width: "100%", minHeight: 44 }} />
      <button className="rd-btn rd-btn-go" onClick={stream} disabled={busy || !sent.length}>{busy ? "Sending pings…" : "Send pings to DockClock"}</button>
      {result && <pre className="rd-banner rd-banner-warn" style={{ whiteSpace: "pre-wrap", margin: 0, fontFamily: "inherit" }} role="status">{result}</pre>}
      <p className="rd-muted">Open the driver link in another tab to watch the clock and payout update live.</p>
    </main>
  );
}
