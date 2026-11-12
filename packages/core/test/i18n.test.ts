import { test } from "node:test";
import assert from "node:assert/strict";
import { MESSAGES, LANGS, t, fmtUsd, voiceIntent, type MsgKey } from "../src/i18n";
import { deriveGeofenceEvents, type Ping } from "../src/geofence";

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

test("A10: every language has the same placeholders and no digits of its own", () => {
  for (const [key, byLang] of Object.entries(MESSAGES)) {
    const want = placeholders(byLang.en);
    for (const l of LANGS) {
      assert.deepEqual(placeholders(byLang[l]), want, `${key}/${l} placeholders`);
      assert.doesNotMatch(byLang[l].replace(/\{\w+\}/g, ""), /[0-9०-९੦-੯]/, `${key}/${l} has a digit`);
    }
  }
});

test("A10: the amount string is identical in every language", () => {
  const amount = fmtUsd(8125);
  for (const l of LANGS) assert.ok(t("youGet", l, { amount }).includes("$81.25"), l);
  assert.throws(() => t("youGet", "hi", {}), /missing \{amount\}/);
  assert.equal(fmtUsd(-250), "-$2.50");
});

test("A9: voice intent is ACCEPT/DECLINE only; ambiguous or unknown asks again", () => {
  assert.equal(voiceIntent("yes accept it"), "ACCEPT");
  assert.equal(voiceIntent("aceptar"), "ACCEPT");
  assert.equal(voiceIntent("हाँ स्वीकार"), "ACCEPT");
  assert.equal(voiceIntent("ਇਨਕਾਰ"), "DECLINE");
  assert.equal(voiceIntent("no thanks"), "DECLINE");
  assert.equal(voiceIntent("yes no"), null);
  assert.equal(voiceIntent("pay me nine hundred"), null);
});

const F = { id: "F", lat: 41.525, lng: -88.0817, radiusM: 300 };
const IN = { lat: 41.525, lng: -88.0817 }, OUT = { lat: 41.53, lng: -88.0817 }; // ~550 m north
const ping = (min: number, at: { lat: number; lng: number }): Ping => ({ tMs: min * 60_000, ...at, source: "ELD" });

test("T14: a short fuel run outside the fence stays one visit", () => {
  const r = deriveGeofenceEvents([ping(0, OUT), ping(5, IN), ping(60, IN), ping(65, OUT), ping(80, OUT), ping(90, IN), ping(200, IN), ping(205, OUT)], F);
  const dep = r.events.find((e) => e.kind === "DEPARTURE")!;
  assert.equal(dep.utcMs, 200 * 60_000);
  assert.ok(r.issues.some((i) => i.includes("same visit")));
});

test("T14: re-entry after more than 30 min outside is a new visit, not billed on this stop", () => {
  const r = deriveGeofenceEvents([ping(0, OUT), ping(5, IN), ping(60, IN), ping(65, OUT), ping(100, OUT), ping(110, IN), ping(200, IN), ping(205, OUT)], F, { maxGapMin: 60 });
  const dep = r.events.find((e) => e.kind === "DEPARTURE")!;
  assert.equal(dep.utcMs, 60 * 60_000);
  assert.ok(r.issues.some((i) => i.includes("new visit")));
});

test("T10: back inside on a new visit means no departure yet, so no settlement", () => {
  const r = deriveGeofenceEvents([ping(0, OUT), ping(5, IN), ping(60, IN), ping(65, OUT), ping(100, OUT), ping(110, IN), ping(200, IN)], F, { maxGapMin: 60 });
  assert.equal(r.events.some((e) => e.kind === "DEPARTURE"), false);
});

test("T8: two positions at the same instant are a spoof", () => {
  const r = deriveGeofenceEvents([ping(0, OUT), ping(5, IN), { tMs: 5 * 60_000, lat: 45, lng: -88, source: "ELD" }, ping(60, IN), ping(65, OUT)], F);
  assert.equal(r.spoofSuspected, true);
  assert.equal(r.events.length, 0);
});

test("T9: a long ping gap before exit gives the departure confidence 0", () => {
  const r = deriveGeofenceEvents([ping(0, OUT), ping(5, IN), ping(60, IN), ping(120, OUT)], F, { maxGapMin: 15 });
  assert.equal(r.events.find((e) => e.kind === "DEPARTURE")!.confidence, 0);
});
