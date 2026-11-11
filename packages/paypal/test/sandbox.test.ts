// Real PayPal sandbox calls. Run: RUN_SANDBOX=1 DC_TEST_VAULT_ID=<vault id> pnpm --filter @dockclock/paypal test
// The vault id comes from one payer approval in /dispatch (stored on the load). Without it there is no way to
// get an authorization without a human approving in the browser (M18).
import { test } from "node:test";
import assert from "node:assert/strict";
import { maxCapturableCents } from "@dockclock/core";
import { createHoldOrderVaulted, authorizationFrom, voidHold, captureFinal } from "../src/index";

const on = process.env.RUN_SANDBOX === "1" && !!process.env.DC_TEST_VAULT_ID;
const vault = process.env.DC_TEST_VAULT_ID ?? "";
const run = Date.now().toString(36);

async function hold(tag: string, cents: number) {
  const loadId = `IT-${run}-${tag}`;
  const { order, authorize } = await createHoldOrderVaulted(loadId, cents, `integration ${tag}`, vault);
  const auth = authorizationFrom((authorize ?? order).data);
  assert.ok(auth, "no authorization");
  console.log(`  ${tag} order=${order.data.id} auth=${auth.id} debug_id=${(authorize ?? order).debugId}`);
  return { loadId, authId: auth.id };
}

test("sandbox: hold -> void", { skip: !on }, async () => {
  const h = await hold("void", 5000);
  const r = await voidHold(h.loadId, h.authId);
  console.log(`  void debug_id=${r.debugId}`);
  assert.ok(r.status === 200 || r.status === 204);
});

test("sandbox: hold -> partial final capture", { skip: !on }, async () => {
  const h = await hold("partial", 30000);
  const r = await captureFinal(h.loadId, h.authId, 8125);
  console.log(`  capture ${r.data.id} ${r.data.status} debug_id=${r.debugId}`);
  assert.equal(r.data.amount?.value, "81.25");
});

test("sandbox: overcapture within min(115%, +$75)", { skip: !on }, async () => {
  const h = await hold("over", 5000);
  const ceiling = maxCapturableCents(5000, true, false); // 5750
  const r = await captureFinal(h.loadId, h.authId, ceiling);
  console.log(`  overcapture ${r.data.id} ${r.data.amount?.value} debug_id=${r.debugId}`);
  assert.equal(r.data.amount?.value, "57.50");
});

test("sandbox: double-submit capture returns the same capture (M8)", { skip: !on }, async () => {
  const h = await hold("double", 10000);
  const [a, b] = await Promise.all([captureFinal(h.loadId, h.authId, 5000), captureFinal(h.loadId, h.authId, 5000)]);
  const c = await captureFinal(h.loadId, h.authId, 5000);
  console.log(`  double ${a.data.id} / ${b.data.id} / ${c.data.id} debug_ids=${a.debugId},${b.debugId},${c.debugId}`);
  assert.equal(a.data.id, c.data.id);
  assert.equal(b.data.id, c.data.id);
});
