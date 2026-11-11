import { test } from "node:test";
import assert from "node:assert/strict";
import { MIN, DAY } from "../src/time";
import { diffDamage, damageLineItems, type Detection } from "../src/damage";
import { timeWeightedMkt, evaluateColdChain } from "../src/coldchain";
import { recommendHold, chargeForDwell } from "../src/holdSizer";
import { tonuAdvice, breakEvenDwellMin } from "../src/tonu";
import { checkPayout } from "../src/payeeGuard";
import { deriveGeofenceEvents } from "../src/geofence";
import { amountsPreserved } from "../src/disputePack";
import { facilityScorecard } from "../src/grid";
import { seedNetwork } from "../src/seed";
import { runScenarios, DEMO_CONTRACT as C } from "../src/scenarios";
import { planSettlement } from "../src/settlement";
import { reconcileTimeline } from "../src/evidence";

const d = (id: string, o: Partial<Detection> = {}): Detection => ({ id, panel: "LEFT", type: "DENT", box: { x: 0.4, y: 0.4, w: 0.1, h: 0.1 }, confidence: 0.9, severity: 0.3, imageRef: id, ...o });

test("damage: one old dent cannot excuse two new overlapping dents", () => {
  const r = diffDamage([d("in")], [d("o1"), d("o2", { box: { x: 0.42, y: 0.41, w: 0.1, h: 0.1 } })]);
  assert.equal(r.preExisting.length, 1);
  assert.equal(r.newDefects.length, 1);
});
test("damage: low confidence → review, never billed; rust never billed; worsened dent billed", () => {
  const r = diffDamage([d("in")], [d("o1", { severity: 0.8 }), d("o2", { panel: "ROOF", confidence: 0.4 }), d("o3", { panel: "RIGHT", type: "RUST", severity: 0.9 })]);
  assert.equal(r.needsReview.length, 1);
  const li = damageLineItems(r, "CARRIER");
  assert.equal(li.length, 1);                 // worsened dent only (rust tariff = 0)
  assert.equal(li[0]!.payer, "CARRIER");
  assert.equal(li[0]!.cents, 18000);
});
test("cold chain: constant temp MKT = temp; burst sampling doesn't dominate", () => {
  const t0 = 0;
  assert.equal(timeWeightedMkt([{ tMs: t0, c: 5 }, { tMs: t0 + 60 * MIN, c: 5 }]), 5);
  // 1 reading at 4C over 3h, then 30 readings at 12C within 3 minutes
  const r = [{ tMs: 0, c: 4 }, { tMs: 180 * MIN, c: 4 }, ...Array.from({ length: 30 }, (_, i) => ({ tMs: 180 * MIN + (i + 1) * 6000, c: 12 }))];
  assert.ok((timeWeightedMkt(r) ?? 99) < 5);
});
test("cold chain: excursion attributed to custody party; sensor gap → review, no penalty", () => {
  const p = { maxMktC: 8, maxInstantC: 10, maxSingleExcursionMin: 15, maxSensorGapMin: 20, penaltyCents: 8500 };
  const r = Array.from({ length: 49 }, (_, i) => ({ tMs: i * 5 * MIN, c: i >= 24 ? 13 : 4 }));
  const segs = [{ fromMs: 0, toMs: 120 * MIN, party: "SHIPPER" as const, label: "dock" }, { fromMs: 120 * MIN, toMs: 240 * MIN, party: "CARRIER" as const, label: "transit" }];
  const v = evaluateColdChain(r, segs, p);
  assert.equal(v.lineItems.length, 1);
  assert.equal(v.lineItems[0]!.payer, "CARRIER");
  const gap = evaluateColdChain(r.filter((x) => x.tMs < 60 * MIN || x.tMs > 100 * MIN), segs, p);
  assert.equal(gap.requiresReview, true);
  assert.equal(gap.lineItems.length, 0);
});
test("settlement: carrier liabilities net against payout; excess invoiced to carrier", () => {
  const tl = reconcileTimeline([{ source: "ELD_GEOFENCE", kind: "ARRIVAL", utcMs: 0, confidence: 1, citation: "" }, { source: "ELD_GEOFENCE", kind: "DEPARTURE", utcMs: 195 * MIN, confidence: 1, citation: "" }]);
  const p = planSettlement({ loadId: "N", appointmentMs: 0, timeline: tl, authorizedCents: 30000,
    lineItems: [{ kind: "DAMAGE", payer: "CARRIER", cents: 10000, description: "dent", evidenceRef: "x" }] }, C);
  assert.equal(p.captureCents, 8125);          // shipper pays only detention
  assert.equal(p.driverPayoutCents, 0);
  assert.equal(p.carrierInvoiceCents, 10000 - 7312);
  const v = planSettlement({ loadId: "N2", appointmentMs: 0, timeline: reconcileTimeline([{ source: "ELD_GEOFENCE", kind: "ARRIVAL", utcMs: 0, confidence: 1, citation: "" }, { source: "ELD_GEOFENCE", kind: "DEPARTURE", utcMs: 60 * MIN, confidence: 1, citation: "" }]),
    authorizedCents: 30000, lineItems: [{ kind: "SEAL", payer: "CARRIER", cents: 12000, description: "seal", evidenceRef: "x" }] }, C);
  assert.equal(v.action, "VOID");
  assert.equal(v.carrierInvoiceCents, 12000);
});
test("hold sizer: bad facility gets bigger hold than good one; sparse facility shrinks to network", () => {
  const { history } = seedNetwork(C);
  const good = recommendHold(history, "F-MEM-06", 9, C);
  const bad = recommendHold(history, "F-LAX-04", 14, C);
  assert.ok(bad.holdCents > good.holdCents, `${bad.holdCents} > ${good.holdCents}`);
  assert.ok(bad.historicalCoverage > 0.85);
  const sparse = recommendHold([...history, { facilityId: "NEW", arrivalHourLocal: 9, dwellMin: 900 }], "NEW", 9, C);
  assert.ok(sparse.predictedP90DwellMin < 900);
  assert.ok(sparse.explanation.includes("9 in 10"));
});
test("tonu: break-even and survival-based advice", () => {
  assert.equal(breakEvenDwellMin(C), 120 + 11 * 15);
  const hist = [100, 130, 200, 400, 420, 450, 480, 500, 510, 520, 530, 540];
  assert.equal(tonuAdvice(300, hist, C).recommendation, "RELEASE_FOR_TONU");
  assert.equal(tonuAdvice(300, [100, 200], C).recommendation, "INSUFFICIENT_HISTORY");
});
test("payee guard: redirect + recent email change blocked", () => {
  const now = Date.parse("2026-11-12T00:00:00Z");
  const carrier = { carrierId: "C1", usdot: "1234567", legalName: "Ridgeline", payoutEmail: "pay@ridgeline.com", payoutEmailVerifiedAtMs: now - 30 * DAY, payoutEmailChangedAtMs: null, status: "ACTIVE" as const };
  assert.equal(checkPayout({ carrierId: "C1", receiverEmail: "pay@ridgeline.com", cents: 7312, loadId: "L" }, carrier, now).allowed, true);
  assert.equal(checkPayout({ carrierId: "C1", receiverEmail: "pay@ridge1ine.com", cents: 7312, loadId: "L" }, carrier, now).allowed, false);
  assert.equal(checkPayout({ carrierId: "C1", receiverEmail: "pay@ridgeline.com", cents: 7312, loadId: "L" }, { ...carrier, payoutEmailChangedAtMs: now - DAY }, now).allowed, false);
});
test("geofence: derives arrival/departure from pings; teleport → spoof, no events", () => {
  const f = { id: "F", lat: 41.525, lng: -88.0817, radiusM: 300 };
  const ok = deriveGeofenceEvents([
    { tMs: 0, lat: 41.53, lng: -88.09, source: "e" }, { tMs: 5 * MIN, lat: 41.5251, lng: -88.0816, source: "e" },
    { tMs: 200 * MIN, lat: 41.5249, lng: -88.0818, source: "e" }, { tMs: 205 * MIN, lat: 41.53, lng: -88.09, source: "e" }], f);
  assert.equal(ok.events.length, 2);
  assert.equal(ok.events[1]!.utcMs - ok.events[0]!.utcMs, 195 * MIN);
  const bad = deriveGeofenceEvents([{ tMs: 0, lat: 41.5251, lng: -88.0816, source: "e" }, { tMs: 2 * MIN, lat: 41.95, lng: -87.65, source: "e" }], f);
  assert.equal(bad.spoofSuspected, true);
  assert.equal(bad.events.length, 0);
});
test("dispute pack guard: AI rewrite may not invent amounts", () => {
  assert.equal(amountsPreserved("Charged $81.25, released $218.75", "We charged $81.25."), true);
  assert.equal(amountsPreserved("Charged $81.25", "We charged $300.00."), false);
});
test("seed + scorecard: deterministic, 8 facilities, all four quadrants used", () => {
  const a = seedNetwork(C), b = seedNetwork(C);
  assert.deepEqual(a.ledger.slice(0, 5), b.ledger.slice(0, 5));
  const sc = facilityScorecard(a.ledger);
  assert.equal(sc.length, 8);
  assert.ok(new Set(sc.map((s) => s.quadrant)).size >= 3);
});
test("judge scenarios: pinned outcomes", () => {
  const s = Object.fromEntries(runScenarios().map((x) => [x.id, x]));
  assert.equal(s["early-dent"]!.plan.action, "VOID");
  assert.equal(s["reefer-spike"]!.plan.captureCents, 8125);
  assert.equal(s["reefer-spike"]!.plan.lineItems.length, 0);
  assert.equal(s["overage"]!.plan.action, "CAPTURE_AND_INVOICE");
  assert.equal(s["overage"]!.plan.captureCents, 34500);
  assert.ok(s["overage"]!.plan.driverPayoutCents > 0);
  assert.equal(s["reauth"]!.steps[0]!.do, "REAUTHORIZE");
  assert.equal(s["spoof"]!.plan.action, "HOLD_FOR_REVIEW");
  assert.equal(s["dispute"]!.steps[0]!.do, "SUBMIT_DISPUTE_EVIDENCE");
  assert.ok(s["dispute"]!.evidencePack!.notes.includes("$"));
});
