// src/paypal.ts
// Thin, correct PayPal REST gateway (Orders v2 AUTHORIZE, Payments v2, Payouts v1, Invoicing v2, Webhooks).
// Fixes vs. the earlier draft:
//  1. Idempotency keys derive from (loadId, operation, stage) — NOT amount (two equal partial captures would collide).
//  2. Webhook verification splices the RAW body into the verify payload. JSON.parse->stringify re-serializes the
//     event and can break signature verification.
//  3. Payouts use a deterministic sender_batch_id (PayPal rejects duplicates) -> retry-safe payouts.
//  4. final_capture:true on the settlement capture auto-releases the rest of the hold; no separate void call.
//  5. Reauthorize is gated by authLifecycle.ts (only after the 3-day honor period, plan for one).
//  6. Vaulting: payer approves ONCE (createHoldOrder with vault=true); every later load is
//     authorized server-side from the vault id with no redirect (createHoldOrderVaulted).

import { paypalRequestId as requestId, centsToPayPal as centsToValue } from "@dockclock/core/ledger";

const BASE = process.env.PAYPAL_ENV === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";

let tokenCache: { token: string; expMs: number } | null = null;

async function accessToken(): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expMs - 60_000) return tokenCache.token;
  const id = process.env.PAYPAL_CLIENT_ID, secret = (process.env.PAYPAL_CLIENT_SECRET ?? process.env.PAYPAL_SECRET);
  if (!id || !secret) throw new Error("PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET (or PAYPAL_SECRET) not set");
  const res = await fetch(`${BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: "Basic " + Buffer.from(`${id}:${secret}`).toString("base64"), "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  const j: any = await res.json();
  if (!res.ok) throw new Error(`OAuth failed: ${JSON.stringify(j)}`);
  tokenCache = { token: j.access_token, expMs: Date.now() + j.expires_in * 1000 };
  return tokenCache.token;
}

export class PayPalError extends Error {
  constructor(public status: number, public debugId: string | null, public body: unknown, msg: string) { super(msg); }
}

async function call<T = any>(method: string, path: string, body?: unknown, reqId?: string, attempt = 0): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${await accessToken()}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(reqId ? { "PayPal-Request-Id": reqId } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const debugId = res.headers.get("paypal-debug-id");
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  // Retry 429/5xx with the SAME request id -> PayPal dedupes, so retries are safe.
  if ((res.status === 429 || res.status >= 500) && attempt < 3 && reqId) {
    await new Promise((r) => setTimeout(r, 250 * 2 ** attempt));
    return call<T>(method, path, body, reqId, attempt + 1);
  }
  if (!res.ok) throw new PayPalError(res.status, debugId, data, `${method} ${path} -> ${res.status} (debug_id=${debugId})`);
  return data as T;
}

// --- Hold lifecycle ---------------------------------------------------------

const unit = (loadId: string, holdCents: number, description: string) => ({
  reference_id: loadId,
  custom_id: loadId,
  description: description.slice(0, 127),
  amount: { currency_code: "USD", value: centsToValue(holdCents) },
});

/**
 * First load for a payer: buyer approves in the JS SDK; with vault=true the
 * approval also saves their PayPal wallet (usage_type MERCHANT) for later loads.
 * After approval call authorizeOrder(); read the vault id with vaultIdFrom().
 */
export function createHoldOrder(loadId: string, holdCents: number, description: string, vault = true) {
  return call("POST", "/v2/checkout/orders", {
    intent: "AUTHORIZE",
    purchase_units: [unit(loadId, holdCents, description)],
    ...(vault ? { payment_source: { paypal: {
      attributes: { vault: { store_in_vault: "ON_SUCCESS", usage_type: "MERCHANT", customer_type: "BUSINESS" } },
      experience_context: { user_action: "CONTINUE", shipping_preference: "NO_SHIPPING", brand_name: "DockClock" },
    } } } : {}),
  }, requestId(loadId, "ORDER", 1));
}

/** Vault id appears only when status is VAULTED (it may arrive later via VAULT.PAYMENT-TOKEN.CREATED). */
export function vaultIdFrom(authorizeResponse: any): string | null {
  const v = authorizeResponse?.payment_source?.paypal?.attributes?.vault;
  return v?.status === "VAULTED" && v?.id ? String(v.id) : null;
}

/** Repeat loads: no buyer redirect. Handles both "auth returned inline" and "needs /authorize". */
export async function createHoldOrderVaulted(loadId: string, holdCents: number, description: string, vaultId: string) {
  const order: any = await call("POST", "/v2/checkout/orders", {
    intent: "AUTHORIZE",
    purchase_units: [unit(loadId, holdCents, description)],
    payment_source: { paypal: { vault_id: vaultId } },
  }, requestId(loadId, "ORDER", "vaulted"));
  const inline = order?.purchase_units?.[0]?.payments?.authorizations?.[0]?.id;
  if (inline) return { orderId: order.id as string, authorizationId: inline as string, raw: order };
  const { authorizationId, raw } = await authorizeOrder(loadId, order.id);
  return { orderId: order.id as string, authorizationId, raw };
}


/** Call after the facility approves the order in the PayPal JS SDK. Returns authorization id. */
export async function authorizeOrder(loadId: string, orderId: string): Promise<{ authorizationId: string; raw: any }> {
  const raw = await call("POST", `/v2/checkout/orders/${orderId}/authorize`, {}, requestId(loadId, "AUTHORIZE", orderId));
  const authorizationId = raw?.purchase_units?.[0]?.payments?.authorizations?.[0]?.id;
  if (!authorizationId) throw new Error("No authorization id in response");
  return { authorizationId, raw };
}

export function captureFinal(loadId: string, authorizationId: string, cents: number, stage = "settle") {
  return call("POST", `/v2/payments/authorizations/${authorizationId}/capture`, {
    amount: { currency_code: "USD", value: centsToValue(cents) },
    final_capture: true,                 // releases any uncaptured remainder of the hold
    invoice_id: `${loadId}-${stage}`,    // PayPal also rejects duplicate invoice_id
    note_to_payer: "Detention per signed rate confirmation",
  }, requestId(loadId, "CAPTURE", stage));
}

export function voidHold(loadId: string, authorizationId: string) {
  return call("POST", `/v2/payments/authorizations/${authorizationId}/void`, undefined, requestId(loadId, "VOID", authorizationId));
}

export function reauthorize(loadId: string, authorizationId: string, cents: number) {
  return call("POST", `/v2/payments/authorizations/${authorizationId}/reauthorize`, {
    amount: { currency_code: "USD", value: centsToValue(cents) },
  }, requestId(loadId, "REAUTHORIZE", authorizationId));
}

// --- Carrier payout (only after PAYMENT.CAPTURE.COMPLETED webhook) ----------

export function payoutCarrier(loadId: string, carrierEmail: string, cents: number, stage = "detention") {
  const batchId = requestId(loadId, "PAYOUT", stage).slice(0, 30);
  return call("POST", "/v1/payments/payouts", {
    sender_batch_header: { sender_batch_id: batchId, email_subject: "Detention paid", email_message: `Load ${loadId}` },
    items: [{
      recipient_type: "EMAIL",
      receiver: carrierEmail,
      amount: { currency: "USD", value: centsToValue(cents) },
      sender_item_id: `${loadId}-${stage}`,
      note: "Detention payout",
    }],
  }, requestId(loadId, "PAYOUT", stage));
}

// --- Spillover invoice -------------------------------------------------------

export async function invoiceSpillover(loadId: string, facilityEmail: string, cents: number) {
  const inv: any = await call("POST", "/v2/invoicing/invoices", {
    detail: { currency_code: "USD", invoice_number: `${loadId}-SPILL`, note: "Detention above pre-authorized hold" },
    primary_recipients: [{ billing_info: { email_address: facilityEmail } }],
    items: [{ name: `Detention overage — load ${loadId}`, quantity: "1", unit_amount: { currency_code: "USD", value: centsToValue(cents) } }],
  }, requestId(loadId, "INVOICE", "create"));
  const id = inv.id ?? String(inv.href ?? "").split("/").pop();
  await call("POST", `/v2/invoicing/invoices/${id}/send`, { send_to_recipient: true }, requestId(loadId, "INVOICE", "send"));
  return id as string;
}

// --- Webhook verification ---------------------------------------------------

/** Build the verify payload with the raw body spliced in byte-for-byte. Exported for tests. */
export function buildVerifyPayload(h: Record<string, string | null>, webhookId: string, rawBody: string): string {
  const meta = {
    auth_algo: h["paypal-auth-algo"],
    cert_url: h["paypal-cert-url"],
    transmission_id: h["paypal-transmission-id"],
    transmission_sig: h["paypal-transmission-sig"],
    transmission_time: h["paypal-transmission-time"],
    webhook_id: webhookId,
  };
  const head = JSON.stringify(meta);
  return `${head.slice(0, -1)},"webhook_event":${rawBody}}`;
}

export async function verifyWebhook(headers: Headers, rawBody: string): Promise<boolean> {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (!webhookId) throw new Error("PAYPAL_WEBHOOK_ID not set");
  const h: Record<string, string | null> = {};
  for (const k of ["paypal-auth-algo", "paypal-cert-url", "paypal-transmission-id", "paypal-transmission-sig", "paypal-transmission-time"]) h[k] = headers.get(k);
  const res = await fetch(`${BASE}/v1/notifications/verify-webhook-signature`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await accessToken()}`, "Content-Type": "application/json" },
    body: buildVerifyPayload(h, webhookId, rawBody),
  });
  if (!res.ok) return false;
  const j: any = await res.json();
  return j.verification_status === "SUCCESS";
}

// --- Disputes: submit the evidence pack (multipart: JSON "input" + files) -----

/** POST /v1/customer/disputes/{id}/provide-evidence. Verify field names against the sandbox before the demo. */
export async function provideDisputeEvidence(disputeId: string, pack: { evidenceType: string; notes: string; documents: Array<{ name: string; ref: string }> },
  files: Array<{ name: string; bytes: Uint8Array<ArrayBuffer>; mime: string }>) {
  const form = new FormData();
  form.append("input", new Blob([JSON.stringify({
    evidences: [{ evidence_type: pack.evidenceType, notes: pack.notes, documents: files.map((f) => ({ name: f.name })) }],
  })], { type: "application/json" }));
  for (const f of files) form.append("file1", new Blob([f.bytes], { type: f.mime }), f.name);
  const res = await fetch(`${BASE}/v1/customer/disputes/${disputeId}/provide-evidence`, {
    method: "POST", headers: { Authorization: `Bearer ${await accessToken()}` }, body: form,
  });
  const debugId = res.headers.get("paypal-debug-id");
  const text = await res.text();
  if (!res.ok) throw new PayPalError(res.status, debugId, text, `provide-evidence -> ${res.status} (debug_id=${debugId})`);
  return text ? JSON.parse(text) : {};
}
