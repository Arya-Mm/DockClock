import { maxCapturableCents, type AccessorialContract } from "./settlement.js";

/**
 * Predictive hold sizing. A flat $300 hold over-reserves at fast docks (payer
 * friction) and under-reserves at bad ones (spillover invoices that don't get
 * paid). We size the PayPal authorization from the facility's dwell history:
 * hierarchical shrinkage (facility×hour-bucket → facility → network) so a
 * facility with 4 loads of history doesn't produce a wild number.
 *
 * Output is explained in plain numbers so the shipper sees WHY the hold is $X.
 */
export interface HistoricalLoad { facilityId: string; arrivalHourLocal: number; dwellMin: number }

export function quantile(xs: number[], q: number): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return s[lo]! + (s[hi]! - s[lo]!) * (pos - lo);
}

const bucketOf = (h: number) => (h < 6 ? "NIGHT" : h < 12 ? "AM" : h < 18 ? "PM" : "EVE");

function shrink(local: number[], parentQ: number, q: number, k: number): { value: number; weight: number } {
  if (local.length === 0) return { value: parentQ, weight: 0 };
  const w = local.length / (local.length + k);
  return { value: w * quantile(local, q) + (1 - w) * parentQ, weight: w };
}

export function chargeForDwell(dwellMin: number, c: AccessorialContract): number {
  const billable = Math.max(0, dwellMin - c.freeTimeMin);
  const inc = c.rounding === "UP" ? Math.ceil(billable / c.incrementMin) : Math.floor(billable / c.incrementMin);
  return Math.min(inc * c.ratePerIncrementCents, c.maxDetentionCents);
}

export interface HoldRecommendation {
  holdCents: number;
  predictedP90DwellMin: number;
  predictedP90ChargeCents: number;
  /** Share of comparable historical loads fully covered by hold + overcapture (no invoice needed). */
  historicalCoverage: number;
  sampleSize: { facilityBucket: number; facility: number; network: number };
  explanation: string;
}

export function recommendHold(history: HistoricalLoad[], facilityId: string, arrivalHourLocal: number, c: AccessorialContract,
  opts: { q?: number; k?: number; minHoldCents?: number; roundToCents?: number } = {}): HoldRecommendation {
  const q = opts.q ?? 0.9, k = opts.k ?? 20, minHold = opts.minHoldCents ?? 5000, step = opts.roundToCents ?? 2500;
  const net = history.map((h) => h.dwellMin);
  const fac = history.filter((h) => h.facilityId === facilityId);
  const bucket = fac.filter((h) => bucketOf(h.arrivalHourLocal) === bucketOf(arrivalHourLocal));
  const netQ = net.length ? quantile(net, q) : c.freeTimeMin + 60;
  const facQ = shrink(fac.map((h) => h.dwellMin), netQ, q, k).value;
  const bQ = shrink(bucket.map((h) => h.dwellMin), facQ, q, k).value;
  const p90Dwell = Math.round(bQ);
  const p90Charge = chargeForDwell(p90Dwell, c);

  // Smallest hold whose capture ceiling (115% / +$75) covers the P90 charge.
  let hold = Math.max(minHold, Math.ceil(p90Charge / 1.15 / step) * step);
  while (maxCapturableCents(hold, true, false) < p90Charge) hold += step;
  hold = Math.min(hold, Math.max(minHold, c.maxDetentionCents));

  const comparable = (bucket.length >= 10 ? bucket : fac.length >= 10 ? fac : history).map((h) => chargeForDwell(h.dwellMin, c));
  const ceiling = maxCapturableCents(hold, true, false);
  const coverage = comparable.length ? comparable.filter((x) => x <= ceiling).length / comparable.length : 1;

  return {
    holdCents: hold,
    predictedP90DwellMin: p90Dwell,
    predictedP90ChargeCents: p90Charge,
    historicalCoverage: Number(coverage.toFixed(3)),
    sampleSize: { facilityBucket: bucket.length, facility: fac.length, network: net.length },
    explanation: `9 in 10 ${bucketOf(arrivalHourLocal)} arrivals at this facility finish within ${p90Dwell}m (from ${bucket.length} similar loads, ${fac.length} at facility). ` +
      `That bills ≤ $${(p90Charge / 100).toFixed(2)}; a $${(hold / 100).toFixed(2)} hold covers it with PayPal overcapture and would have covered ${(coverage * 100).toFixed(0)}% of past loads.`,
  };
}
