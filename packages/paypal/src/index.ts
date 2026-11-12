// PayPal REST gateway for money WRITES (Orders v2 AUTHORIZE, Payments v2, Payouts v1, Invoicing v2, Webhooks, Disputes).
// Docs: https://developer.paypal.com/docs/api/orders/v2/  https://developer.paypal.com/docs/api/payments/v2/
// Rules (CLAUDE.md): every write carries a stage-scoped PayPal-Request-Id; amounts only via centsToPayPal.
// History (from core v3): ids from (loadId, op, stage) not amount; raw-body webhook verify; deterministic
// sender_batch_id; final_capture releases the remainder; reauth gated by authLifecycle; vault on first approval.
import { paypalRequestId as requestId, centsToPayPal as centsToValue } from "@dockclock/core/ledger";

export const PAYPAL_BASE = process.env.PAYPAL_ENV === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";

export interface PayPalResult<T> { data: T; debugId: string | null; status: number; requestId: string | null }

export class PayPalError extends Error {
  constructor(public status: number, public debugId: string | null, public body: unknown, msg: string) { super(msg); this.name = "PayPalError"; }
  /** First issue code, e.g. INSTRUMENT_DECLINED, AUTHORIZATION_VOIDED. */
  get issue(): string | null {
    const b = this.body as { details?: Array<{ issue?: string }>; name?: string } | null;
    return b?.details?.[0]?.issue ?? b?.name ?? null;
  }
}

let tokenCache: { token: string; expMs: number } | null = null;

function basicAuth(): string {
  const id = process.env.PAYPAL_CLIENT_ID, secret = process.env.PAYPAL_CLIENT_SECRET ?? process.env.PAYPAL_SECRET;
  if (!id || !secret) throw new Error("PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET not set");
  return "Basic " + Buffer.from(`${id}:${secret}`).toString("base64");
}

async function oauth(extra: Record<string, string> = {}): Promise<{ access_token: string; expires_in: number }> {
  const res = await fetch(`${PAYPAL_BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: basicAuth(), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", ...extra }).toString(),
    cache: "no-store",
  });
  const j = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!res.ok || !j.access_token) throw new PayPalError(res.status, res.headers.get("paypal-debug-id"), j, `OAuth failed (${res.status})`);
  return { access_token: j.access_token, expires_in: j.expires_in ?? 0 };
}

export async function accessToken(): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expMs - 60_000) return tokenCache.token;
  const t = await oauth();
  tokenCache = { token: t.access_token, expMs: Date.now() + t.expires_in * 1000 };
  return tokenCache.token;
}

/** Browser-safe token for JS SDK v6 (sample: paypal-examples/v6-web-sdk-sample-integration authRouteHandler). */
export async function browserClientToken(): Promise<{ accessToken: string; expiresIn: number }> {
  const t = await oauth({ response_type: "client_token" });
  return { accessToken: t.access_token, expiresIn: t.expires_in };
}

const MAX_RETRIES = 3;

export async function call<T>(method: "GET" | "POST" | "PATCH", path: string, body?: unknown, reqId?: string, attempt = 0): Promise<PayPalResult<T>> {
  const res = await fetch(`${PAYPAL_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${await accessToken()}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(reqId ? { "PayPal-Request-Id": reqId } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const debugId = res.headers.get("paypal-debug-id");
  const text = await res.text();
  let data: unknown = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text.slice(0, 500) }; } // non-JSON 5xx must still retry
  // Retry 429/5xx with the SAME request id -> PayPal dedupes, so retries are safe. GETs are naturally idempotent.
  if ((res.status === 429 || res.status >= 500) && attempt < MAX_RETRIES && (reqId || method === "GET")) {
    await new Promise((r) => setTimeout(r, 250 * 2 ** attempt));
    return call<T>(method, path, body, reqId, attempt + 1);
  }
  if (!res.ok) throw new PayPalError(res.status, debugId, data, `${method} ${path} -> ${res.status} (debug_id=${debugId})`);
  return { data: data as T, debugId, status: res.status, requestId: reqId ?? null };
}

// --- Response shapes (only fields we read) -------------------------------------

export interface Money { currency_code: string; value: string }
export interface Authorization { id: string; status: string; amount?: Money; expiration_time?: string; create_time?: string }
export interface Capture { id: string; status: string; amount?: Money; status_details?: { reason?: string }; final_capture?: boolean }
export interface Order {
  id: string;
  status: string;
  links?: Array<{ href: string; rel: string; method?: string }>;
  payment_source?: { paypal?: { email_address?: string; attributes?: { vault?: { id?: string; status?: string; customer?: { id?: string } } } } };
  purchase_units?: Array<{ reference_id?: string; payments?: { authorizations?: Authorization[]; captures?: Capture[] } }>;
}

// --- Hold lifecycle --------------------------------------------------------------

const appUrl = () => process.env.APP_URL ?? "http://localhost:3000";

const unit = (loadId: string, holdCents: number, description: string) => ({
  reference_id: loadId,
  custom_id: loadId,
  description: description.slice(0, 127),
  amount: { currency_code: "USD", value: centsToValue(holdCents) },
});

/**
 * First load for a payer: buyer approves in JS SDK v6. With vault=true the approval also saves their PayPal wallet.
 * Doc: https://developer.paypal.com/docs/checkout/save-payment-methods/during-purchase/orders-api/paypal/
 */
export function createHoldOrder(loadId: string, holdCents: number, description: string, vault = true) {
  return call<Order>("POST", "/v2/checkout/orders", {
    intent: "AUTHORIZE",
    purchase_units: [unit(loadId, holdCents, description)],
    payment_source: { paypal: {
      ...(vault ? { attributes: { vault: { store_in_vault: "ON_SUCCESS", usage_type: "MERCHANT", customer_type: "CONSUMER" } } } : {}),
      experience_context: { user_action: "CONTINUE", shipping_preference: "NO_SHIPPING", brand_name: "DockClock",
        return_url: `${appUrl()}/dispatch/approved`, cancel_url: `${appUrl()}/dispatch` },
    } },
  }, requestId(loadId, "ORDER", vault ? "vault" : 1));
}

/** Vault id appears only when status is VAULTED (else later via VAULT.PAYMENT-TOKEN.CREATED). */
export function vaultIdFrom(o: Order): string | null {
  const v = o.payment_source?.paypal?.attributes?.vault;
  return v?.status === "VAULTED" && v.id ? v.id : null;
}

export const authorizationFrom = (o: Order): Authorization | null => o.purchase_units?.[0]?.payments?.authorizations?.[0] ?? null;

/** Call after the payer approves. Returns the order with the authorization. */
export function authorizeOrder(loadId: string, orderId: string) {
  return call<Order>("POST", `/v2/checkout/orders/${orderId}/authorize`, {}, requestId(loadId, "AUTHORIZE", orderId));
}

/** Repeat loads: no buyer redirect. Handles both "auth returned inline" and "needs /authorize". */
export async function createHoldOrderVaulted(loadId: string, holdCents: number, description: string, vaultId: string, stage = "vaulted") {
  const order = await call<Order>("POST", "/v2/checkout/orders", {
    intent: "AUTHORIZE",
    purchase_units: [unit(loadId, holdCents, description)],
    payment_source: { paypal: { vault_id: vaultId } },
  }, requestId(loadId, "ORDER", stage));
  if (authorizationFrom(order.data)) return { order, authorize: null };
  const authorize = await authorizeOrder(loadId, order.data.id);
  return { order, authorize };
}

/**
 * Carrier-paid purchase (priority slot, part) as a CAPTURE order the carrier approves in PayPal (§5.9).
 * Docs: https://developer.paypal.com/api/orders/v2/orders-create (experience_context -> link rel "payer-action").
 * stage = the offer id, so one offer can never create two orders.
 */
export function createPurchaseOrder(loadId: string, cents: number, description: string, stage: string, returnUrl: string, cancelUrl: string) {
  return call<Order>("POST", "/v2/checkout/orders", {
    intent: "CAPTURE",
    purchase_units: [unit(loadId, cents, description)],
    payment_source: { paypal: { experience_context: { return_url: returnUrl, cancel_url: cancelUrl, user_action: "PAY_NOW", shipping_preference: "NO_SHIPPING" } } },
  }, requestId(loadId, "ORDER", stage));
}

/** Docs: https://developer.paypal.com/api/orders/v2/orders-capture (empty body; PayPal-Request-Id supported). */
export function captureOrder(loadId: string, orderId: string, stage: string) {
  return call<Order>("POST", `/v2/checkout/orders/${orderId}/capture`, {}, requestId(loadId, "CAPTURE", stage));
}

export const approveLinkOf = (o: Order) => o.links?.find((l) => l.rel === "payer-action" || l.rel === "approve")?.href ?? null;

export function getOrder(orderId: string) { return call<Order>("GET", `/v2/checkout/orders/${orderId}`); }
export function getAuthorization(id: string) { return call<Authorization>("GET", `/v2/payments/authorizations/${id}`); }
export function getCapture(id: string) { return call<Capture>("GET", `/v2/payments/captures/${id}`); }

/** final_capture:true releases any uncaptured remainder of the hold (M16). */
export function captureFinal(loadId: string, authorizationId: string, cents: number, stage = "settle") {
  return call<Capture>("POST", `/v2/payments/authorizations/${authorizationId}/capture`, {
    amount: { currency_code: "USD", value: centsToValue(cents) },
    final_capture: true,
    invoice_id: `${loadId}-${stage}`,
    note_to_payer: "Detention per signed rate confirmation",
  }, requestId(loadId, "CAPTURE", stage));
}

export function voidHold(loadId: string, authorizationId: string) {
  return call<Partial<Authorization>>("POST", `/v2/payments/authorizations/${authorizationId}/void`, undefined, requestId(loadId, "VOID", authorizationId));
}

/** Gated by authLifecycle (only after the 3-day honor period, planned once). Returns a NEW authorization id. */
export function reauthorize(loadId: string, authorizationId: string, cents: number) {
  return call<Authorization>("POST", `/v2/payments/authorizations/${authorizationId}/reauthorize`, {
    amount: { currency_code: "USD", value: centsToValue(cents) },
  }, requestId(loadId, "REAUTHORIZE", authorizationId));
}

// --- Carrier payout (only after PAYMENT.CAPTURE.COMPLETED) -----------------------

export interface PayoutBatch { batch_header?: { payout_batch_id?: string; batch_status?: string } }

export function payoutCarrier(loadId: string, carrierEmail: string, cents: number, stage = "detention") {
  const batchId = requestId(loadId, "PAYOUT", stage).slice(0, 30);
  return call<PayoutBatch>("POST", "/v1/payments/payouts", {
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

// --- Spillover invoice -------------------------------------------------------------

/** stage "spill" = shipper overage above the hold; "carrier" = carrier liabilities beyond its payout. */
export async function invoiceSpillover(loadId: string, recipientEmail: string, cents: number, stage = "spill") {
  const create = await call<{ id?: string; href?: string }>("POST", "/v2/invoicing/invoices", {
    detail: { currency_code: "USD", invoice_number: `${loadId}-${stage.toUpperCase()}`, note: stage === "spill" ? "Detention above pre-authorized hold" : "Carrier liabilities on this load (damage, seals, missing equipment)" },
    primary_recipients: [{ billing_info: { email_address: recipientEmail } }],
    items: [{ name: stage === "spill" ? `Detention overage — load ${loadId}` : `Carrier liabilities — load ${loadId}`, quantity: "1", unit_amount: { currency_code: "USD", value: centsToValue(cents) } }],
  }, requestId(loadId, "INVOICE", `create-${stage}`));
  const id = create.data.id ?? String(create.data.href ?? "").split("/").pop() ?? "";
  const send = await call<unknown>("POST", `/v2/invoicing/invoices/${id}/send`, { send_to_recipient: true }, requestId(loadId, "INVOICE", `send-${stage}`));
  return { id, create, send };
}

// --- Webhook verification -------------------------------------------------------

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
  const res = await fetch(`${PAYPAL_BASE}/v1/notifications/verify-webhook-signature`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await accessToken()}`, "Content-Type": "application/json" },
    body: buildVerifyPayload(h, webhookId, rawBody),
  });
  if (!res.ok) return false;
  const j = (await res.json()) as { verification_status?: string };
  return j.verification_status === "SUCCESS";
}

// --- Disputes: submit the evidence pack (multipart: JSON "input" + files) -----------

/** POST /v1/customer/disputes/{id}/provide-evidence. Verify field names against the sandbox before the demo (Phase 2). */
export async function provideDisputeEvidence(disputeId: string, pack: { evidenceType: string; notes: string; documents: Array<{ name: string; ref: string }> },
  files: Array<{ name: string; bytes: Uint8Array<ArrayBuffer>; mime: string }>) {
  const form = new FormData();
  form.append("input", new Blob([JSON.stringify({
    evidences: [{ evidence_type: pack.evidenceType, notes: pack.notes, documents: files.map((f) => ({ name: f.name })) }],
  })], { type: "application/json" }));
  for (const f of files) form.append("file1", new Blob([f.bytes], { type: f.mime }), f.name);
  const res = await fetch(`${PAYPAL_BASE}/v1/customer/disputes/${disputeId}/provide-evidence`, {
    method: "POST", headers: { Authorization: `Bearer ${await accessToken()}` }, body: form,
  });
  const debugId = res.headers.get("paypal-debug-id");
  const text = await res.text();
  if (!res.ok) throw new PayPalError(res.status, debugId, text, `provide-evidence -> ${res.status} (debug_id=${debugId})`);
  return { data: (text ? JSON.parse(text) : {}) as unknown, debugId, status: res.status, requestId: null };
}

// --- Phase 2: refunds, payouts status, reporting, disputes, webhooks ---------------

/** Doc: developer.paypal.com/api/payments/v2/captures-refund (empty body = full refund). */
export function refundCapture(loadId: string, captureId: string, cents: number | null, stage = "dispute") {
  return call<{ id: string; status: string; amount?: Money }>("POST", `/v2/payments/captures/${captureId}/refund`, {
    ...(cents != null ? { amount: { currency_code: "USD", value: centsToValue(cents) } } : {}),
    invoice_id: `${loadId}-refund-${stage}`.slice(0, 127),
    note_to_payer: "Refund per DockClock dispute outcome",
  }, requestId(loadId, "REFUND", stage));
}

export interface PayoutBatchDetail {
  batch_header?: { payout_batch_id?: string; batch_status?: string };
  items?: Array<{ payout_item_id?: string; transaction_status?: string; payout_item?: { sender_item_id?: string } }>;
}
/** Doc: developer.paypal.com/api/payments.payouts-batch/v1/payouts-get */
export function getPayoutBatch(batchId: string) { return call<PayoutBatchDetail>("GET", `/v1/payments/payouts/${batchId}`); }

export interface TxnDetail { transaction_info?: { transaction_id?: string; transaction_event_code?: string; transaction_amount?: Money; invoice_id?: string; custom_field?: string } }
/** Doc: developer.paypal.com/api/transaction-search/v1/search-get (range max 31 days, data lags up to 3h). */
export function searchTransactions(startIso: string, endIso: string, page = 1) {
  const q = new URLSearchParams({ start_date: startIso, end_date: endIso, fields: "transaction_info", page_size: "500", page: String(page) });
  return call<{ transaction_details?: TxnDetail[]; total_pages?: number }>("GET", `/v1/reporting/transactions?${q}`);
}

/** Doc: developer.paypal.com/api/customer-disputes/v1/disputes-list */
export function listDisputes() { return call<{ items?: Array<{ dispute_id: string; status?: string; reason?: string }> }>("GET", "/v1/customer/disputes?page_size=50"); }
export function getDispute(id: string) {
  return call<{ dispute_id: string; status?: string; disputed_transactions?: Array<{ seller_transaction_id?: string }>; dispute_outcome?: { outcome_code?: string } }>("GET", `/v1/customer/disputes/${id}`);
}

/** Doc: developer.paypal.com/api/webhooks/v1/webhooks-post */
export function createWebhook(url: string, eventTypes: string[]) {
  return call<{ id: string; url: string }>("POST", "/v1/notifications/webhooks", { url, event_types: eventTypes.map((name) => ({ name })) });
}
export function listWebhooks() { return call<{ webhooks?: Array<{ id: string; url: string }> }>("GET", "/v1/notifications/webhooks"); }
/** Doc: developer.paypal.com/api/webhooks/v1/simulate-event-post */
export function simulateWebhook(webhookId: string, eventType: string) {
  return call<{ id: string; event_type: string }>("POST", "/v1/notifications/simulate-event", { webhook_id: webhookId, event_type: eventType });
}

/** Events DockClock subscribes to (core README). Payments v2 declines are PAYMENT.CAPTURE.DECLINED; DENIED kept for v1. */
export const WEBHOOK_EVENTS = [
  "PAYMENT.AUTHORIZATION.CREATED", "PAYMENT.AUTHORIZATION.VOIDED",
  "PAYMENT.CAPTURE.COMPLETED", "PAYMENT.CAPTURE.PENDING", "PAYMENT.CAPTURE.DENIED", "PAYMENT.CAPTURE.DECLINED", "PAYMENT.CAPTURE.REFUNDED",
  "PAYMENT.PAYOUTS-ITEM.SUCCEEDED", "PAYMENT.PAYOUTS-ITEM.UNCLAIMED", "PAYMENT.PAYOUTS-ITEM.FAILED", "PAYMENT.PAYOUTS-ITEM.BLOCKED", "PAYMENT.PAYOUTS-ITEM.RETURNED",
  "VAULT.PAYMENT-TOKEN.CREATED", "CUSTOMER.DISPUTE.CREATED", "CUSTOMER.DISPUTE.RESOLVED", "INVOICING.INVOICE.PAID",
] as const;
