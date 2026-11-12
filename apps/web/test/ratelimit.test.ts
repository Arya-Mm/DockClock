import { test } from "node:test";
import assert from "node:assert/strict";
import { allowWrite } from "../lib/server/http";

test("per-IP write limit: 30 per minute, then blocked, then a new window", () => {
  const prev = process.env.DOCKCLOCK_OPS_KEY;
  process.env.DOCKCLOCK_OPS_KEY = "test-key"; // a caller without the key is rate limited
  const req = () => new Request("http://x/api/loads", { method: "POST", headers: { "x-forwarded-for": "203.0.113.9" } });
  for (let i = 0; i < 30; i++) assert.equal(allowWrite(req(), 1_000), true);
  assert.equal(allowWrite(req(), 1_000), false);
  assert.equal(allowWrite(req(), 61_000), true);
  assert.equal(allowWrite(new Request("http://x", { method: "POST", headers: { "x-forwarded-for": "203.0.113.9", "x-ops-key": "test-key" } }), 1_500), true);
  process.env.DOCKCLOCK_OPS_KEY = prev;
});
