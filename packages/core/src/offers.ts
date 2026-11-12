import { chargeForDwell } from "./holdSizer";
import { tonuAdvice } from "./tonu";
import { maxCapturableCents, type AccessorialContract, type SettlementPlan } from "./settlement";

/**
 * Offer pricing (PLAN §4.3). Deterministic, integer cents. This is the ONLY source of an offer's price:
 * the agents pick an offer kind, never a number (prime directive, A1).
 */
export type OfferKind = "WAIT_GUARANTEED" | "SLOT_SWAP_WITH_CREDIT" | "RELEASE_TONU" | "PRIORITY_SLOT_PURCHASE" | "PART_PURCHASE";
export const OFFER_KINDS: readonly OfferKind[] = ["WAIT_GUARANTEED", "SLOT_SWAP_WITH_CREDIT", "RELEASE_TONU", "PRIORITY_SLOT_PURCHASE", "PART_PURCHASE"];

/** Who funds the offer. Shipper-funded offers are captured from the shipper's PayPal hold. */
export const OFFER_FUNDER: Record<OfferKind, "SHIPPER" | "FACILITY" | "CARRIER"> = {
  WAIT_GUARANTEED: "SHIPPER", RELEASE_TONU: "SHIPPER", SLOT_SWAP_WITH_CREDIT: "FACILITY", PRIORITY_SLOT_PURCHASE: "CARRIER", PART_PURCHASE: "CARRIER",
};

export interface PricingContext {
  waitedMin: number;
  historicalDwellsMin: number[];
  /** Minutes the carrier saves by taking an earlier door (swap / priority). */
  minutesSaved?: number;
  /** Facility's value of one door-minute, from facility config (not LLM). */
  facilityDoorMinuteCents?: number;
  /** Facility opportunity-cost band for selling a priority slot. */
  priorityBandCents?: { lo: number; hi: number };
  /** Channel3 quote: price + delivery, and the carrier's parts cap. */
  partQuote?: { priceCents: number; deliveryCents: number; capCents: number };
}

export interface PricedOffer { kind: OfferKind; priceCents: number; basis: string }

/** Demo facility economics (config, not LLM): value of a door-minute and the priority-slot band. Synthetic. */
export const DEMO_FACILITY_ECONOMICS = { doorMinuteCents: 50, priorityBandCents: { lo: 2_500, hi: 6_000 }, swapSlotLeadMin: 15 } as const;

const usd = (c: number) => `$${(c / 100).toFixed(2)}`;
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** Expected final dwell: survival-model median, else waited + 60 min as a conservative fallback. */
function expectedFinalMin(ctx: PricingContext, c: AccessorialContract): number {
  return tonuAdvice(ctx.waitedMin, ctx.historicalDwellsMin, c).expectedFinalDwellMin ?? ctx.waitedMin + 60;
}

export function expectedDetentionCents(ctx: PricingContext, c: AccessorialContract): number {
  return chargeForDwell(expectedFinalMin(ctx, c), c);
}

/** null = this kind cannot be offered in this context (missing inputs, or over the carrier's cap). */
export function priceOffer(kind: OfferKind, ctx: PricingContext, c: AccessorialContract): PricedOffer | null {
  const expected = expectedDetentionCents(ctx, c);
  switch (kind) {
    case "WAIT_GUARANTEED":
      // chargeForDwell already caps at maxDetentionCents. Nothing expected => nothing to guarantee.
      if (expected <= 0) return null;
      return { kind, priceCents: expected, basis: `expected detention ${usd(expected)} (contract cap ${usd(c.maxDetentionCents)})` };
    case "SLOT_SWAP_WITH_CREDIT": {
      if (!ctx.minutesSaved || !ctx.facilityDoorMinuteCents) return null;
      const final = expectedFinalMin(ctx, c);
      const avoided = expected - chargeForDwell(Math.max(ctx.waitedMin, final - ctx.minutesSaved), c);
      if (avoided <= 0) return null;
      // A12 collusion bound: credit always within [10%, 60%] of detention avoided.
      const p = clamp(ctx.minutesSaved * ctx.facilityDoorMinuteCents, Math.ceil(avoided * 0.1), Math.floor(avoided * 0.6));
      return { kind, priceCents: p, basis: `time saved ${ctx.minutesSaved}m x ${usd(ctx.facilityDoorMinuteCents)}/m, bounded to 10-60% of ${usd(avoided)} detention avoided` };
    }
    case "RELEASE_TONU":
      return { kind, priceCents: c.tonuFlatCents, basis: `contract TONU flat fee ${usd(c.tonuFlatCents)}` };
    case "PRIORITY_SLOT_PURCHASE": {
      if (!ctx.minutesSaved || !ctx.facilityDoorMinuteCents || !ctx.priorityBandCents) return null;
      const { lo, hi } = ctx.priorityBandCents;
      return { kind, priceCents: clamp(ctx.minutesSaved * ctx.facilityDoorMinuteCents, lo, hi), basis: `facility opportunity cost band ${usd(lo)}-${usd(hi)}` };
    }
    case "PART_PURCHASE": {
      const q = ctx.partQuote;
      if (!q) return null;
      const p = q.priceCents + q.deliveryCents;
      if (p > q.capCents) return null;
      return { kind, priceCents: p, basis: `Channel3 ${usd(q.priceCents)} + delivery ${usd(q.deliveryCents)} <= parts cap ${usd(q.capCents)}` };
    }
  }
}

/** Deterministic default offer (A6): what the Facility Agent sends when the LLM times out or returns junk. */
/** null = no detention is expected, so there is nothing worth offering yet. */
export function defaultOffer(ctx: PricingContext, c: AccessorialContract): PricedOffer | null {
  return priceOffer("SLOT_SWAP_WITH_CREDIT", ctx, c) ?? priceOffer("WAIT_GUARANTEED", ctx, c);
}

/**
 * An accepted shipper-funded offer (WAIT_GUARANTEED, RELEASE_TONU) replaces the metered detention with the agreed
 * engine price: "guaranteed, no dispute later". Line items (damage, seal, etc.) still apply on top, same allocation
 * as planSettlement: pass-through first, then the offer amount split by driverShareBps.
 */
export function applyAcceptedOffer(plan: SettlementPlan, offer: { id: string; kind: OfferKind; priceCents: number }, authorizedCents: number, c: AccessorialContract, overcapture = true): SettlementPlan {
  if (OFFER_FUNDER[offer.kind] !== "SHIPPER") return plan;
  const shipperItems = plan.lineItems.filter((i) => i.payer === "SHIPPER").reduce((s, i) => s + i.cents, 0);
  const carrierItems = plan.lineItems.filter((i) => i.payer === "CARRIER").reduce((s, i) => s + i.cents, 0);
  const chargeCents = offer.priceCents + shipperItems;
  const ceiling = maxCapturableCents(authorizedCents, overcapture, false);
  const captureCents = Math.min(chargeCents, ceiling);
  const invoiceCents = chargeCents - captureCents;
  const passThrough = Math.min(captureCents, shipperItems);
  const carrierGross = Math.floor(((captureCents - passThrough) * c.driverShareBps) / 10_000) + passThrough;
  const net = carrierGross - carrierItems;
  return {
    ...plan,
    action: captureCents === 0 ? "VOID" : invoiceCents > 0 ? "CAPTURE_AND_INVOICE" : "CAPTURE",
    chargeCents, captureCents, invoiceCents,
    releasedCents: Math.max(0, authorizedCents - captureCents),
    driverPayoutCents: Math.max(0, net), carrierInvoiceCents: Math.max(0, -net), platformRetainedCents: captureCents - carrierGross,
    audit: [...plan.audit, `Accepted agent offer ${offer.id} (${offer.kind}) ${usd(offer.priceCents)} replaces metered detention ${usd(plan.chargeCents - shipperItems)}`],
  };
}

// --- Carrier Agent valuation (PLAN §4.4) -----------------------------------------------------------

export interface CarrierClock {
  /** Simulated ELD: driving minutes left today (11h rule) and on-duty window minutes left (14h rule). */
  hosDrivingLeftMin: number;
  hosWindowLeftMin: number;
  /** Next appointment: minutes from now and the deadhead drive to get there. */
  nextApptInMin: number;
  deadheadMin: number;
  revenuePerHourCents: number;
  nextLoadRevenueCents: number;
}

export interface OptionInput { offerId: string; offer: PricedOffer; extraWaitMin: number }
export interface ValuationRow { offerId: string; kind: OfferKind; payoutCents: number; hoursLostCents: number; missRiskCents: number; netCents: number; makesNextLoad: boolean }

/** One row per option: net = payout - value of driving hours lost - risk of missing the next load. */
export function valueOption(o: OptionInput, clock: CarrierClock): ValuationRow {
  const payout = OFFER_FUNDER[o.offer.kind] === "CARRIER" ? -o.offer.priceCents : o.offer.priceCents;
  const hoursLost = Math.round((o.extraWaitMin / 60) * clock.revenuePerHourCents);
  // The wait burns the 14h window; the deadhead must still fit both HOS limits and land before the appointment.
  const makes = clock.hosWindowLeftMin - o.extraWaitMin >= clock.deadheadMin && clock.hosDrivingLeftMin >= clock.deadheadMin
    && o.extraWaitMin + clock.deadheadMin <= clock.nextApptInMin;
  const missRisk = makes ? 0 : clock.nextLoadRevenueCents;
  return { offerId: o.offerId, kind: o.offer.kind, payoutCents: payout, hoursLostCents: hoursLost, missRiskCents: missRisk, netCents: payout - hoursLost - missRisk, makesNextLoad: makes };
}

/** Rows best-first (stable). The Carrier Agent's deterministic choice is rows[0]. */
export function rankOptions(options: OptionInput[], clock: CarrierClock): ValuationRow[] {
  return options.map((o, i) => ({ r: valueOption(o, clock), i })).sort((a, b) => b.r.netCents - a.r.netCents || a.i - b.i).map((x) => x.r);
}
