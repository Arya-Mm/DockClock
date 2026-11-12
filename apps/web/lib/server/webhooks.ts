import "server-only";
import { z } from "zod";
import { prisma, Prisma } from "@dockclock/db";
import { verifyWebhook } from "@dockclock/paypal";
import type { PayPalOutcome } from "@dockclock/core";
import { applyOutcome, notify, type StepResult } from "./executor";

const Envelope = z.object({
  id: z.string().min(1),
  event_type: z.string().min(1),
  resource: z.record(z.string(), z.unknown()).default({}),
});
type Resource = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : undefined);

export type IngestResult =
  | { status: 401; reason: string }
  | { status: 400; reason: string }
  | { status: 200; duplicate: true; eventId: string }
  | { status: 200; duplicate: false; eventId: string; handled: string };

/**
 * PayPal webhook ingest (M9, F2):
 * 1. verify the signature over the RAW body (forged -> 401, nothing stored, so a forged id cannot block the real event);
 * 2. insert into WebhookEvent; unique event_id makes replays a no-op;
 * 3. dispatch; each handler checks the load state first, so stale or out-of-order events never move state backwards.
 */
export async function ingestWebhook(rawBody: string, headers: Headers): Promise<IngestResult> {
  const verified = await verifyWebhook(headers, rawBody).catch(() => false);
  if (!verified) return { status: 401, reason: "signature verification failed" };

  let json: unknown;
  try { json = JSON.parse(rawBody); } catch { return { status: 400, reason: "body is not JSON" }; }
  const parsed = Envelope.safeParse(json);
  if (!parsed.success) return { status: 400, reason: "malformed event" };
  const evt = parsed.data;
  const resourceId = str(evt.resource.id) ?? str(evt.resource.dispute_id) ?? null;

  try {
    await prisma.webhookEvent.create({ data: { eventId: evt.id, eventType: evt.event_type, resourceId, verified: true, rawBody } });
  } catch (e) {
    if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e;
    // Replay of a stored event: no-op only if it was processed. A crash mid-dispatch leaves processedAt null and
    // PayPal's retry re-dispatches it (handlers are forward-only, PayPal writes are request-id keyed).
    const prior = await prisma.webhookEvent.findUnique({ where: { eventId: evt.id }, select: { processedAt: true } });
    if (prior?.processedAt) return { status: 200, duplicate: true, eventId: evt.id };
  }
  const handled = await dispatch(evt.event_type, evt.resource);
  await prisma.webhookEvent.update({ where: { eventId: evt.id }, data: { processedAt: new Date() } });
  return { status: 200, duplicate: false, eventId: evt.id, handled };
}

async function loadBy(where: Prisma.LoadWhereInput) {
  return prisma.load.findFirst({ where, select: { id: true, state: true } });
}

/** Shared by webhooks and the worker poll fallback (M10). */
export async function onCaptureOutcome(loadId: string, outcome: PayPalOutcome): Promise<StepResult[] | "stale"> {
  const l = await prisma.load.findUnique({ where: { id: loadId }, select: { state: true } });
  // Forward-only: a capture outcome only matters while the load sits in CAPTURED (payout not yet sent).
  if (!l || (l.state !== "SETTLING" && l.state !== "CAPTURED" && l.state !== "INVOICED_SPILLOVER")) return "stale";
  if (outcome.type === "CAPTURE_COMPLETED") {
    const paid = await prisma.payPalOp.findFirst({ where: { loadId, operation: "PAYOUT", status: "SUCCEEDED" } });
    if (paid) return "stale";
  }
  return applyOutcome(loadId, outcome);
}

async function dispatch(type: string, r: Resource): Promise<string> {
  const id = str(r.id);
  switch (type) {
    case "PAYMENT.CAPTURE.COMPLETED":
    case "PAYMENT.CAPTURE.PENDING":
    case "PAYMENT.CAPTURE.DENIED":
    case "PAYMENT.CAPTURE.DECLINED": {
      const load = id ? await loadBy({ captureId: id }) : null;
      if (!load || !id) return "ignored: capture not ours";
      const outcome: PayPalOutcome =
        type === "PAYMENT.CAPTURE.COMPLETED" ? { type: "CAPTURE_COMPLETED", captureId: id }
        : type === "PAYMENT.CAPTURE.PENDING" ? { type: "CAPTURE_PENDING", captureId: id, reason: str((r.status_details as Resource | undefined)?.reason) ?? "PENDING" }
        : { type: "CAPTURE_FAILED", issue: "INSTRUMENT_DECLINED" };
      const res = await onCaptureOutcome(load.id, outcome);
      return res === "stale" ? `stale: load ${load.id} already past CAPTURED` : `applied ${outcome.type} to ${load.id}`;
    }
    case "PAYMENT.AUTHORIZATION.VOIDED": {
      const load = id ? await loadBy({ authorizationId: id }) : null;
      if (!load) return "ignored: authorization not ours";
      const ours = await prisma.payPalOp.findFirst({ where: { loadId: load.id, operation: "VOID", paypalId: id, status: "SUCCEEDED" } });
      if (ours) return "ack: void we issued";
      // M12: payer voided the hold in their PayPal account. Settlement will replace it from the vault or invoice.
      await notify(load.id, "OPS", "NOTIFY", `payer voided authorization ${id} outside DockClock (M12)`);
      return `flagged ${load.id}: external void`;
    }
    case "PAYMENT.PAYOUTS-ITEM.SUCCEEDED":
    case "PAYMENT.PAYOUTS-ITEM.UNCLAIMED":
    case "PAYMENT.PAYOUTS-ITEM.FAILED":
    case "PAYMENT.PAYOUTS-ITEM.BLOCKED":
    case "PAYMENT.PAYOUTS-ITEM.RETURNED": {
      const batchId = str(r.payout_batch_id);
      const load = batchId ? await loadBy({ payoutBatchId: batchId }) : null;
      if (!load) return "ignored: payout not ours";
      const outcome: PayPalOutcome =
        type.endsWith("SUCCEEDED") ? { type: "PAYOUT_SUCCEEDED" }
        : type.endsWith("UNCLAIMED") ? { type: "PAYOUT_UNCLAIMED" }
        : { type: "PAYOUT_FAILED", issue: str(r.transaction_status) ?? type.split(".").pop() ?? "FAILED" };
      if (outcome.type === "PAYOUT_SUCCEEDED" && load.state === "PAID_OUT") return `stale: ${load.id} already PAID_OUT`;
      await applyOutcome(load.id, outcome);
      return `applied ${outcome.type} to ${load.id}`;
    }
    case "CUSTOMER.DISPUTE.CREATED": {
      const disputeId = str(r.dispute_id);
      const txns = Array.isArray(r.disputed_transactions) ? (r.disputed_transactions as Resource[]) : [];
      const captureIds = txns.map((t) => str(t.seller_transaction_id)).filter((x): x is string => !!x);
      const load = disputeId && captureIds.length ? await loadBy({ captureId: { in: captureIds } }) : null;
      if (!load || !disputeId) return "ignored: dispute not on a DockClock capture";
      if (load.state === "DISPUTED") return `stale: ${load.id} already DISPUTED`;
      await applyOutcome(load.id, { type: "DISPUTE_CREATED", disputeId });
      return `evidence flow started for ${load.id}`;
    }
    case "CUSTOMER.DISPUTE.RESOLVED": {
      // M15: PayPal moves the money itself when a dispute is lost; we write the reversal into our ledger (idempotent
      // by dispute id) and tell ops to recover the carrier's share. A won dispute just closes.
      const disputeId = str(r.dispute_id);
      const outcome = str((r.dispute_outcome as Resource | undefined)?.outcome_code) ?? "UNKNOWN";
      const load = disputeId ? await loadBy({ disputeId }) : null;
      if (!load || !disputeId) return "ignored: dispute not on a DockClock load";
      if (outcome !== "RESOLVED_BUYER_FAVOUR") { await notify(load.id, "OPS", "NOTIFY", `dispute ${disputeId} resolved: ${outcome}`); return `closed ${disputeId}: ${outcome}`; }
      const amt = (r.dispute_amount as Resource | undefined)?.value;
      const cents = typeof amt === "string" && /^\d+(\.\d{1,2})?$/.test(amt) ? Math.round(Number(amt) * 100) : null; // PayPal decimal string -> cents at the boundary
      await prisma.payPalOp.upsert({ where: { requestId: `reversal-${disputeId}` }, update: {}, create: {
        requestId: `reversal-${disputeId}`, operation: "DISPUTE_REVERSAL", loadId: load.id, amountCents: cents, status: "SUCCEEDED", paypalId: disputeId, response: r as Prisma.InputJsonValue } });
      await notify(load.id, "OPS", "MANUAL_REVIEW", `dispute ${disputeId} lost: ${cents === null ? "amount unknown" : `$${(cents / 100).toFixed(2)}`} reversed by PayPal; recover carrier share (M15)`);
      return `reversal recorded for ${load.id}`;
    }
    case "VAULT.PAYMENT-TOKEN.CREATED":
    case "INVOICING.INVOICE.PAID":
    case "PAYMENT.AUTHORIZATION.CREATED":
    case "PAYMENT.CAPTURE.REFUNDED":
      await notify(null, "OPS", "NOTIFY", `${type} ${id ?? ""}`.trim());
      return "recorded";
    default:
      return "ignored: unsubscribed type";
  }
}
