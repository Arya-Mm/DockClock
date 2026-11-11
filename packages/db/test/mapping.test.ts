import { test } from "node:test";
import assert from "node:assert/strict";
import { stateForAction, sha256Json } from "../src/mapping.js";

test("sha256Json is key-order independent", () => {
  assert.equal(sha256Json({ a: 1, b: { c: 2, d: [1, 2] } }), sha256Json({ b: { d: [1, 2], c: 2 }, a: 1 }));
  assert.notEqual(sha256Json({ a: 1 }), sha256Json({ a: 2 }));
});

test("stateForAction covers every settlement action", () => {
  assert.equal(stateForAction("VOID"), "VOIDED");
  assert.equal(stateForAction("CAPTURE"), "CAPTURED");
  assert.equal(stateForAction("CAPTURE_AND_INVOICE"), "INVOICED");
  assert.equal(stateForAction("HOLD_FOR_REVIEW"), "REVIEW");
});
