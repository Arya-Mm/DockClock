import { MIN, DAY } from "./time";
import { reconcileTimeline, type EvidenceEvent } from "./evidence";
import { planSettlement, type AccessorialContract } from "./settlement";
import { toLedgerRow, type LedgerRow } from "./grid";
import { chargeForDwell, type HistoricalLoad } from "./holdSizer";

/**
 * Deterministic synthetic network (same seed → same data) so the AG Studio
 * dashboard, the hold-size model and the video are reproducible. Every row is
 * produced by the REAL settlement engine, not hand-typed numbers.
 * Labelled synthetic in the UI and README.
 */
export function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const FACILITIES = [
  { id: "F-CHI-01", name: "Joliet Grocery DC", tz: "America/Chicago", medianDwell: 95, spread: 0.35, latePct: 0.08, pmPenalty: 1.1, paperOnlyPct: 0.05 },
  { id: "F-ATL-02", name: "Fulton Retail Crossdock", tz: "America/New_York", medianDwell: 140, spread: 0.45, latePct: 0.1, pmPenalty: 1.3, paperOnlyPct: 0.3 },
  { id: "F-DAL-03", name: "Mesquite Beverage Plant", tz: "America/Chicago", medianDwell: 210, spread: 0.5, latePct: 0.12, pmPenalty: 1.4, paperOnlyPct: 0.08 },
  { id: "F-LAX-04", name: "Carson Import Terminal", tz: "America/Los_Angeles", medianDwell: 260, spread: 0.55, latePct: 0.15, pmPenalty: 1.2, paperOnlyPct: 0.35 },
  { id: "F-NJ-05", name: "Edison Pharma 3PL", tz: "America/New_York", medianDwell: 110, spread: 0.3, latePct: 0.05, pmPenalty: 1.05, paperOnlyPct: 0.04 },
  { id: "F-MEM-06", name: "Memphis Parcel Hub", tz: "America/Chicago", medianDwell: 80, spread: 0.3, latePct: 0.07, pmPenalty: 1.0, paperOnlyPct: 0.25 },
  { id: "F-SEA-07", name: "Kent Cold Storage", tz: "America/Los_Angeles", medianDwell: 175, spread: 0.4, latePct: 0.09, pmPenalty: 1.25, paperOnlyPct: 0.1 },
  { id: "F-PHX-08", name: "Tolleson Building Supply", tz: "America/Phoenix", medianDwell: 230, spread: 0.6, latePct: 0.2, pmPenalty: 1.5, paperOnlyPct: 0.4 },
] as const;

const CARRIERS = ["Ridgeline Transport", "Blue Mesa Freight", "Kowalski & Sons Trucking", "Northstar Reefer", "Lone Oak Logistics", "Prairie Haul LLC"];

export function seedNetwork(c: AccessorialContract, opts: { seed?: number; loads?: number; nowMs?: number } = {}) {
  const rnd = mulberry32(opts.seed ?? 20261112);
  const n = opts.loads ?? 640;
  const now = opts.nowMs ?? Date.parse("2026-11-11T00:00:00Z");
  const normal = () => { const u = 1 - rnd(), v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const history: HistoricalLoad[] = [];
  const ledger: LedgerRow[] = [];

  for (let i = 0; i < n; i++) {
    const f = FACILITIES[Math.floor(rnd() * FACILITIES.length)]!;
    const carrier = CARRIERS[Math.floor(rnd() * CARRIERS.length)]!;
    const hourLocal = 5 + Math.floor(rnd() * 15);
    const appt = now - Math.floor(rnd() * 60) * DAY + hourLocal * 60 * MIN;
    const late = rnd() < f.latePct;
    const arrivalOffset = late ? 20 + Math.floor(rnd() * 60) : Math.floor(normal() * 12) - 10;
    const pm = hourLocal >= 12 ? f.pmPenalty : 1;
    const dwell = Math.max(25, Math.round(f.medianDwell * pm * Math.exp(f.spread * normal())));
    // Facilities without a gate system / drivers without ELD sharing leave only paper: those loads stall in review.
    const src = rnd() < f.paperOnlyPct ? "BOL_AI_EXTRACTED" : "ELD_GEOFENCE";
    const ev: EvidenceEvent[] = [
      { source: src, kind: "ARRIVAL", utcMs: appt + arrivalOffset * MIN, confidence: src === "ELD_GEOFENCE" ? 1 : 0.9, citation: "seed" },
      { source: src, kind: "DEPARTURE", utcMs: appt + (arrivalOffset + dwell) * MIN, confidence: src === "ELD_GEOFENCE" ? 1 : 0.9, citation: "seed" },
    ];
    const plan = planSettlement({ loadId: `LD-${String(10000 + i)}`, appointmentMs: appt, timeline: reconcileTimeline(ev), authorizedCents: 30000 }, c);
    history.push({ facilityId: f.id, arrivalHourLocal: hourLocal, dwellMin: dwell });
    ledger.push(toLedgerRow(plan, { facilityId: f.id, facilityName: f.name, carrierName: carrier, appointmentMs: appt,
      claimedUsd: chargeForDwell(Math.max(0, dwell - Math.max(0, -arrivalOffset)), c) / 100 }));
  }
  return { history, ledger };
}
