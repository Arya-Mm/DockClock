import { test } from "node:test";
import assert from "node:assert/strict";
import { DEMO_CONTRACT as C } from "../src/scenarios";
import { priceOffer, defaultOffer, rankOptions, type CarrierClock } from "../src/offers";

// 20 loads that ran 240-335 min: a truck at 180m is expected to finish around the median survivor.
const hist = Array.from({ length: 20 }, (_, i) => 240 + i * 5);
const ctx = { waitedMin: 180, historicalDwellsMin: hist, minutesSaved: 60, facilityDoorMinuteCents: 50, priorityBandCents: { lo: 2500, hi: 6000 } };

test("every price is an integer number of cents from the engine", () => {
  for (const k of ["WAIT_GUARANTEED", "SLOT_SWAP_WITH_CREDIT", "RELEASE_TONU", "PRIORITY_SLOT_PURCHASE"] as const) {
    const p = priceOffer(k, ctx, C);
    assert.ok(p && Number.isInteger(p.priceCents) && p.priceCents > 0, k);
  }
});

test("WAIT_GUARANTEED never exceeds the contract detention cap", () => {
  const p = priceOffer("WAIT_GUARANTEED", { waitedMin: 600, historicalDwellsMin: Array(20).fill(2000) }, C)!;
  assert.equal(p.priceCents, C.maxDetentionCents);
});

test("A12: swap credit is bounded to 10-60% of detention avoided, even with an inflated door value", () => {
  const p = priceOffer("SLOT_SWAP_WITH_CREDIT", { ...ctx, facilityDoorMinuteCents: 1_000_000 }, C)!;
  const lo = priceOffer("SLOT_SWAP_WITH_CREDIT", { ...ctx, facilityDoorMinuteCents: 1 }, C)!;
  assert.ok(p.priceCents > lo.priceCents);
  assert.ok(lo.priceCents * 6 >= p.priceCents - 6, "ceiling 60% vs floor 10%");
});

test("RELEASE_TONU is the contract flat fee; PART_PURCHASE over cap is not offerable", () => {
  assert.equal(priceOffer("RELEASE_TONU", ctx, C)!.priceCents, C.tonuFlatCents);
  assert.equal(priceOffer("PART_PURCHASE", { ...ctx, partQuote: { priceCents: 9000, deliveryCents: 2000, capCents: 10000 } }, C), null);
  assert.equal(priceOffer("PART_PURCHASE", { ...ctx, partQuote: { priceCents: 7000, deliveryCents: 2000, capCents: 10000 } }, C)!.priceCents, 9000);
});

test("A6: default offer without optional inputs is the guarantee; nothing is offered when no detention is expected", () => {
  assert.equal(defaultOffer({ waitedMin: 150, historicalDwellsMin: [] }, C)?.kind, "WAIT_GUARANTEED");
  assert.equal(defaultOffer({ waitedMin: 30, historicalDwellsMin: [] }, C), null);
  assert.equal(priceOffer("WAIT_GUARANTEED", { waitedMin: 0, historicalDwellsMin: [] }, C), null);
});

test("carrier valuation: a payout that costs the next load ranks below a smaller one that keeps it", () => {
  const clock: CarrierClock = { hosDrivingLeftMin: 300, hosWindowLeftMin: 240, nextApptInMin: 300, deadheadMin: 150, revenuePerHourCents: 9000, nextLoadRevenueCents: 120000 };
  const rows = rankOptions([
    { offerId: "wait", offer: { kind: "WAIT_GUARANTEED", priceCents: 20000, basis: "" }, extraWaitMin: 150 },
    { offerId: "swap", offer: { kind: "SLOT_SWAP_WITH_CREDIT", priceCents: 3000, basis: "" }, extraWaitMin: 20 },
  ], clock);
  assert.equal(rows[0]!.offerId, "swap");
  assert.equal(rows[1]!.makesNextLoad, false);
  assert.equal(rows[1]!.missRiskCents, 120000);
});

import { applyAcceptedOffer } from "../src/offers";
import { planSettlement } from "../src/settlement";
import { reconcileTimeline } from "../src/evidence";
test("accepted WAIT_GUARANTEED replaces metered detention, within the hold ceiling, split by driver share", () => {
  const base = planSettlement({ loadId: "L1", appointmentMs: 0, timeline: reconcileTimeline([{ source: "ELD_GEOFENCE", kind: "ARRIVAL", utcMs: 0, confidence: 1, citation: "a" }, { source: "ELD_GEOFENCE", kind: "DEPARTURE", utcMs: 300 * 60_000, confidence: 1, citation: "d" }]), authorizedCents: 10_000, overcaptureEnabled: true }, C);
  const p = applyAcceptedOffer(base, { id: "O1", kind: "WAIT_GUARANTEED", priceCents: 9_000 }, 10_000, C);
  assert.equal(p.captureCents, 9_000);
  assert.equal(p.releasedCents, 1_000);
  assert.equal(p.driverPayoutCents, 8_100);
  assert.equal(p.platformRetainedCents, 900);
  assert.equal(applyAcceptedOffer(base, { id: "O2", kind: "SLOT_SWAP_WITH_CREDIT", priceCents: 1 }, 10_000, C), base);
});
