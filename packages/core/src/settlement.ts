import { localWallClockToUtc } from "./time";
import { MIN } from "./time";
import type { ResolvedTimeline } from "./evidence";

/** Version-pinned accessorial terms. Every settlement records contractVersionId. */
export interface AccessorialContract {
  contractVersionId: string;
  currency: "USD";
  freeTimeMin: number;            // e.g. 120
  incrementMin: number;           // e.g. 15
  ratePerIncrementCents: number;  // e.g. 1625 = $65/hr
  rounding: "UP" | "DOWN";        // how a partial increment bills
  maxDetentionCents: number;      // per-stop detention cap
  lateGraceMin: number;           // e.g. 15
  lateArrivalPolicy: "WAIVE_DETENTION" | "CLOCK_FROM_ARRIVAL";
  tonuFlatCents: number;
  driverShareBps: number;         // 9000 = 90% of collected detention to driver
  /** T12: daily closed windows in facility local time, e.g. lunch lockout {start:"12:00",end:"12:30"}. Non-billable. */
  pausedLocalWindows?: { start: string; end: string; reason: string }[];
}

export interface DelayInterval {
  startMs: number;
  endMs: number;
  /** Carrier-caused time (driver missing paperwork, reefer failure) is not billable. */
  attributedTo: "CARRIER" | "FACILITY";
  reason: string;
}

export interface SettlementInput {
  loadId: string;
  appointmentMs: number;
  timeline: ResolvedTimeline;
  delays?: DelayInterval[];
  aborted?: boolean;              // truck released unloaded => TONU
  /** Amount currently held on the PayPal authorization. */
  authorizedCents: number;
  /** PSD2 payers (EU/UK consumers) cannot be over-captured. */
  payerIsPsd2?: boolean;
  /** Overcapture enabled on the merchant account (default PayPal limit). */
  overcaptureEnabled?: boolean;
  /** Non-detention charges from damage diff, cold chain, hardware, etc. */
  lineItems?: LineItem[];
  /** T12: facility closed hours from the contract, already converted to UTC (pausedIntervalsFor). Non-billable. */
  facilityPausedIntervals?: { startMs: number; endMs: number; reason: string }[];
}

/**
 * Direction matters. SHIPPER items are captured from the shipper's hold and
 * passed 100% to the carrier (e.g. facility forklift damaged the trailer).
 * CARRIER items are netted against the carrier's payout (carrier dented the
 * container, missing straps bought via Channel3, reefer excursion in carrier
 * custody). If the carrier owes more than it earned, it gets an invoice.
 */
export interface LineItem {
  kind: "DAMAGE" | "SEAL" | "COLD_CHAIN" | "HARDWARE" | "OTHER";
  payer: "SHIPPER" | "CARRIER";
  cents: number;
  description: string;
  evidenceRef: string;
}

export type SettlementAction =
  | "VOID"                       // nothing owed: release the hold
  | "CAPTURE"                    // capture <= authorized (+ allowed overcapture)
  | "CAPTURE_AND_INVOICE"        // capture max allowed, invoice the remainder
  | "HOLD_FOR_REVIEW";           // evidence too weak; money does not move

export interface SettlementPlan {
  loadId: string;
  contractVersionId: string;
  action: SettlementAction;
  arrivalClass: "EARLY" | "ON_TIME" | "LATE" | "UNKNOWN";
  dwellMin: number;
  excludedCarrierMin: number;
  /** T12: minutes inside contract closed hours (optional for plans saved before T12). */
  excludedPausedMin?: number;
  billableMin: number;
  increments: number;
  chargeCents: number;
  captureCents: number;
  releasedCents: number;
  invoiceCents: number;
  driverPayoutCents: number;
  platformRetainedCents: number;
  /** Carrier owes more than it earned on this load. */
  carrierInvoiceCents: number;
  lineItems: LineItem[];
  audit: string[];
}

const usd = (c: number) => `$${(c / 100).toFixed(2)}`;

/** PayPal: sum of captures may reach 115% of the auth or +$75, whichever is less. */
export function maxCapturableCents(authorizedCents: number, overcapture: boolean, psd2: boolean): number {
  if (!overcapture || psd2) return authorizedCents;
  return Math.min(Math.floor(authorizedCents * 1.15), authorizedCents + 7_500);
}

function overlapMs(a0: number, a1: number, b0: number, b1: number): number {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
}

/** Merge overlapping intervals so double-logged carrier delays aren't subtracted twice. */
function mergedCarrierIntervals(delays: DelayInterval[]): Array<[number, number]> {
  return merge(delays.filter((d) => d.attributedTo === "CARRIER").map((d) => [d.startMs, d.endMs] as [number, number]));
}

function merge(intervals: Array<[number, number]>): Array<[number, number]> {
  const xs = intervals.filter(([a, b]) => b > a).map(([a, b]) => [a, b] as [number, number]).sort((a, b) => a[0] - b[0]);
  const out: Array<[number, number]> = [];
  for (const x of xs) {
    const last = out[out.length - 1];
    if (last && x[0] <= last[1]) last[1] = Math.max(last[1], x[1]);
    else out.push([x[0], x[1]]);
  }
  return out;
}

export function planSettlement(input: SettlementInput, c: AccessorialContract): SettlementPlan {
  const audit: string[] = [`Contract ${c.contractVersionId}`, ...input.timeline.basis];
  const base = {
    loadId: input.loadId, contractVersionId: c.contractVersionId,
    dwellMin: 0, excludedCarrierMin: 0, billableMin: 0, increments: 0,
    chargeCents: 0, captureCents: 0, releasedCents: 0, invoiceCents: 0,
    driverPayoutCents: 0, platformRetainedCents: 0, carrierInvoiceCents: 0,
    lineItems: input.lineItems ?? [],
  };
  for (const li of base.lineItems) {
    if (!Number.isInteger(li.cents) || li.cents < 0) throw new Error(`line item ${li.description}: cents must be a non-negative integer`);
  }

  if (!Number.isInteger(input.authorizedCents) || input.authorizedCents <= 0) {
    throw new Error("authorizedCents must be a positive integer");
  }

  const { arrivalMs, departureMs } = input.timeline;
  if (input.timeline.requiresReview || arrivalMs === null || departureMs === null) {
    audit.push(`HOLD: evidence flags [${input.timeline.flags.join(", ")}] — no money moves without approval`);
    return { ...base, action: "HOLD_FOR_REVIEW", arrivalClass: "UNKNOWN", audit };
  }

  // --- TONU short-circuit: flat fee replaces detention, never both.
  let detentionCents = 0;
  let arrivalClass: SettlementPlan["arrivalClass"] = "ON_TIME";
  let dwellMin = 0, excludedCarrierMin = 0, excludedPausedMin = 0, billableMin = 0, increments = 0;

  if (input.aborted) {
    detentionCents = c.tonuFlatCents;
    audit.push(`TONU: truck released unloaded — flat ${usd(c.tonuFlatCents)}`);
  } else {
    const lateBy = arrivalMs - input.appointmentMs;
    let clockStart: number;
    if (lateBy < 0) {
      arrivalClass = "EARLY";
      clockStart = input.appointmentMs;
      audit.push(`Early by ${Math.round(-lateBy / MIN)}m — clock starts at appointment, not arrival`);
    } else if (lateBy > c.lateGraceMin * MIN) {
      arrivalClass = "LATE";
      clockStart = arrivalMs;
      audit.push(`Late by ${Math.round(lateBy / MIN)}m (grace ${c.lateGraceMin}m) — policy ${c.lateArrivalPolicy}`);
    } else {
      clockStart = arrivalMs;
    }

    const waived = arrivalClass === "LATE" && c.lateArrivalPolicy === "WAIVE_DETENTION";
    const clockEnd = Math.max(clockStart, departureMs);
    dwellMin = Math.floor((clockEnd - clockStart) / MIN);

    const inClock = (xs: Array<[number, number]>) => xs.reduce((s, [a, b]) => s + overlapMs(clockStart, clockEnd, a, b), 0);
    const carrier = mergedCarrierIntervals(input.delays ?? []);
    const paused = merge((input.facilityPausedIntervals ?? []).map((p) => [p.startMs, p.endMs] as [number, number]));
    excludedCarrierMin = Math.floor(inClock(carrier) / MIN);
    excludedPausedMin = Math.floor(inClock(paused) / MIN);
    // T12: contract-defined closed hours are non-billable. Union with carrier delays so an overlap is excluded once.
    const excludedMin = Math.floor(inClock(merge([...carrier, ...paused])) / MIN);
    if (excludedCarrierMin > 0) audit.push(`Excluded ${excludedCarrierMin}m carrier-caused delay`);
    if (excludedPausedMin > 0) audit.push(`Excluded ${excludedPausedMin}m facility closed hours per contract (${(input.facilityPausedIntervals ?? []).map((p) => p.reason).filter((v, i, a) => a.indexOf(v) === i).join(", ")})`);

    const netMin = Math.max(0, dwellMin - excludedMin);
    billableMin = waived ? 0 : Math.max(0, netMin - c.freeTimeMin);
    increments = c.rounding === "UP" ? Math.ceil(billableMin / c.incrementMin) : Math.floor(billableMin / c.incrementMin);
    const raw = increments * c.ratePerIncrementCents;
    detentionCents = Math.min(raw, c.maxDetentionCents);
    audit.push(
      waived ? `Detention waived (late arrival)`
        : `Net dwell ${netMin}m − free ${c.freeTimeMin}m = ${billableMin}m → ${increments}×${c.incrementMin}m @ ${usd(c.ratePerIncrementCents)} = ${usd(raw)}` +
          (raw > c.maxDetentionCents ? ` capped to ${usd(c.maxDetentionCents)}` : ""),
    );
  }

  const items = base.lineItems;
  const shipperItemsCents = items.filter((i) => i.payer === "SHIPPER").reduce((x, i) => x + i.cents, 0);
  const carrierItemsCents = items.filter((i) => i.payer === "CARRIER").reduce((x, i) => x + i.cents, 0);
  for (const i of items) audit.push(`${i.kind} ${usd(i.cents)} payable by ${i.payer}: ${i.description} [${i.evidenceRef}]`);

  const chargeCents = detentionCents + shipperItemsCents;
  if (chargeCents === 0) {
    audit.push(`Shipper owes nothing — VOID hold of ${usd(input.authorizedCents)}`);
    if (carrierItemsCents > 0) audit.push(`Carrier owes ${usd(carrierItemsCents)} with no earnings to net against → invoice carrier`);
    return { ...base, action: "VOID", arrivalClass, dwellMin, excludedCarrierMin, excludedPausedMin, billableMin, increments,
      releasedCents: input.authorizedCents, carrierInvoiceCents: carrierItemsCents, audit };
  }

  const ceiling = maxCapturableCents(input.authorizedCents, input.overcaptureEnabled ?? true, input.payerIsPsd2 ?? false);
  const captureCents = Math.min(chargeCents, ceiling);
  const invoiceCents = chargeCents - captureCents;
  const releasedCents = Math.max(0, input.authorizedCents - captureCents);
  if (captureCents > input.authorizedCents) audit.push(`Overcapture ${usd(captureCents - input.authorizedCents)} within PayPal 115%/$75 limit`);
  if (invoiceCents > 0) audit.push(`Spillover ${usd(invoiceCents)} beyond capture ceiling ${usd(ceiling)} → invoice shipper`);

  // Capture is allocated to pass-through items first (100% to carrier), then detention (share split).
  const capturedPassThrough = Math.min(captureCents, shipperItemsCents);
  const capturedDetention = captureCents - capturedPassThrough;
  const carrierGross = Math.floor((capturedDetention * c.driverShareBps) / 10_000) + capturedPassThrough;
  const net = carrierGross - carrierItemsCents;
  const driverPayoutCents = Math.max(0, net);
  const carrierInvoiceCents = Math.max(0, -net);
  const platformRetainedCents = captureCents - carrierGross; // rounding remainder stays here, never invented
  if (carrierItemsCents > 0) audit.push(`Netted ${usd(carrierItemsCents)} carrier liabilities against ${usd(carrierGross)} earnings`);
  if (carrierInvoiceCents > 0) audit.push(`Carrier still owes ${usd(carrierInvoiceCents)} → invoice carrier`);
  audit.push(`Capture ${usd(captureCents)}, release ${usd(releasedCents)}; carrier payout ${usd(driverPayoutCents)} after capture COMPLETED`);

  return {
    ...base, action: invoiceCents > 0 ? "CAPTURE_AND_INVOICE" : "CAPTURE",
    arrivalClass, dwellMin, excludedCarrierMin, excludedPausedMin, billableMin, increments,
    chargeCents, captureCents, releasedCents, invoiceCents, driverPayoutCents, platformRetainedCents, carrierInvoiceCents, audit,
  };
}

/**
 * T12: contract closed windows (local wall clock, IANA zone) -> UTC intervals covering [fromMs, toMs].
 * Each day is converted separately, so DST days get the right offset. Windows that cross midnight are not supported.
 */
export function pausedIntervalsFor(c: AccessorialContract, zone: string, fromMs: number, toMs: number): { startMs: number; endMs: number; reason: string }[] {
  const out: { startMs: number; endMs: number; reason: string }[] = [];
  if (!c.pausedLocalWindows?.length || toMs <= fromMs) return out;
  const day = (ms: number) => new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(ms);
  const seen = new Set<string>();
  for (let t = fromMs - 86_400_000; t <= toMs + 86_400_000; t += 3_600_000) {
    const d = day(t);
    if (seen.has(d)) continue;
    seen.add(d);
    for (const w of c.pausedLocalWindows) {
      const a = localWallClockToUtc(`${d}T${w.start}`, zone), b = localWallClockToUtc(`${d}T${w.end}`, zone);
      if (a.ok && b.ok && b.utcMs > a.utcMs && b.utcMs > fromMs && a.utcMs < toMs) out.push({ startMs: a.utcMs, endMs: b.utcMs, reason: w.reason });
    }
  }
  return out.sort((x, y) => x.startMs - y.startMs);
}
