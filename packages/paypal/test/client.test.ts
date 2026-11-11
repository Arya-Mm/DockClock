import { test } from "node:test";
import assert from "node:assert/strict";
import { PayPalError, vaultIdFrom, authorizationFrom, type Order } from "../src/index";

test("PayPalError exposes issue code and debug id", () => {
  const e = new PayPalError(422, "dbg123", { name: "UNPROCESSABLE_ENTITY", details: [{ issue: "AUTHORIZATION_VOIDED" }] }, "x");
  assert.equal(e.issue, "AUTHORIZATION_VOIDED");
  assert.equal(e.debugId, "dbg123");
});

test("vaultIdFrom only trusts VAULTED status", () => {
  const o = (status: string): Order => ({ id: "O", status: "COMPLETED", payment_source: { paypal: { attributes: { vault: { id: "v1", status } } } } });
  assert.equal(vaultIdFrom(o("VAULTED")), "v1");
  assert.equal(vaultIdFrom(o("APPROVED")), null);
});

test("authorizationFrom reads the first authorization", () => {
  const o: Order = { id: "O", status: "COMPLETED", purchase_units: [{ payments: { authorizations: [{ id: "A1", status: "CREATED" }] } }] };
  assert.equal(authorizationFrom(o)?.id, "A1");
  assert.equal(authorizationFrom({ id: "O", status: "CREATED" }), null);
});
