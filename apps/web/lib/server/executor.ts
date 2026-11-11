import "server-only";
import { prisma } from "@dockclock/db";
import {
  nextSteps, authState, checkPayout, buildEvidencePack, reconcileTimeline, paypalRequestId,
  type Step, type PayPalOutcome, type SettlementPlan, type LoadState, type EvidenceEvent,
} from "@dockclock/core";
import {
  captureFinal, invoiceSpillover, payoutCarrier, createHoldOrderVaulted, authorizationFrom, provideDisputeEvidence,
  type Capture, type PayoutBatch, type Order,
} from "@dockclock/paypal";
import { recorded } from "./ops";
import { getLoad, moveState } from "./loads";
import { reauthorizeHold, voidLoadHold } from "./holds";
import { DomainError } from "./http";

export interface StepResult { step: Step; status: "DONE" | "DEFERRED" | "FAILED" | "SKIPPED" | "BLOCKED"; debugId?: string | null; requestId?: string; paypalId?: string; replayed?: boolean; note?: string }

export async function notify(loadId: string | null, who: string, kind: "NOTIFY" | "MANUAL_REVIEW" | "BLOCKED", message: string) {
  await prisma.notification.create({ data: { loadId, who, kind, message } });
}

export async function latestPlan(loadId: string): Promise<SettlementPlan> {
  const p = await prisma.plan.findFirst({ where: { loadId }, orderBy: { version: "desc" } });
  if (!p) throw new DomainError("no_plan", `load ${loadId} has no settlement plan`);
  return p.body as unknown as SettlementPlan;
}

async function authOf(loadId: string, nowMs: number) {
  const l = await getLoad(loadId);
  if (!l.authorizationId || !l.authorizedAt || !l.lastAuthorizedAt) throw new DomainError("no_hold", "load has no authorization");
  return authState({ authorizationId: l.authorizationId, originalAuthorizedAtMs: l.authorizedAt.getTime(), lastAuthorizedAtMs: l.lastAuthorizedAt.getTime(), reauthCount: l.reauthCount }, nowMs);
}

/** Run steps in order; stop at the first that has to wait or fails (later steps depend on it). */
export async function runSteps(loadId: string, steps: Step[], plan: SettlementPlan, nowMs = Date.now()): Promise<StepResult[]> {
  const out: StepResult[] = [];
  for (const step of steps) {
    const r = await runStep(loadId, step, plan, nowMs);
    out.push(r);
    if (r.status !== "DONE" && r.status !== "SKIPPED") break;
  }
  return out;
}

/**
 * Applies a PayPal outcome (from a webhook or the poll fallback) through core nextSteps.
 * Idempotent: every PayPal write inside goes through recorded(), keyed by stage.
 */
export async function applyOutcome(loadId: string, outcome: PayPalOutcome, nowMs = Date.now()): Promise<StepResult[]> {
  const plan = await latestPlan(loadId);
  const auth = await authOf(loadId, nowMs);
  const load = await getLoad(loadId);
  const state = load.state as LoadState;

  if (outcome.type === "PAYOUT_SUCCEEDED" && (state === "CAPTURED" || state === "INVOICED_SPILLOVER")) await moveState(loadId, state, "PAID_OUT");
  if (outcome.type === "DISPUTE_CREATED" && ["CAPTURED", "PAID_OUT", "INVOICED_SPILLOVER"].includes(state)) {
    await moveState(loadId, state, "DISPUTED", { disputeId: outcome.disputeId });
  }
  return runSteps(loadId, nextSteps(plan, auth, outcome), plan, nowMs);
}

async function runStep(loadId: string, step: Step, plan: SettlementPlan, nowMs: number): Promise<StepResult> {
  switch (step.do) {
    case "VOID": {
      const r = await voidLoadHold(loadId);
      return { step, status: "DONE", debugId: r.debugId, paypalId: r.authorizationId, replayed: r.replayed };
    }
    case "REAUTHORIZE": {
      const r = await reauthorizeHold(loadId, nowMs);
      return { step, status: "DONE", debugId: r.debugId, paypalId: r.authorizationId, replayed: r.replayed };
    }
    case "REPLACE_AUTH_FROM_VAULT": {
      // M2: expired or voided auth -> new hold from the vault, same amount. Stage keyed by the dead auth id.
      const load = await getLoad(loadId);
      if (!load.vaultId || !load.holdCents || !load.authorizationId) return { step, status: "FAILED", note: "no vault id: cannot replace hold" };
      const vaultId = load.vaultId, cents = load.holdCents, stage = `replace-${load.authorizationId}`;
      const r = await recorded<Order>({ loadId, operation: "ORDER_VAULTED", requestId: paypalRequestId(loadId, "ORDER", stage), amountCents: cents }, async () => {
        const { order, authorize } = await createHoldOrderVaulted(loadId, cents, `DockClock replacement hold, load ${loadId}`, vaultId, stage);
        return authorize ?? order;
      });
      const auth = authorizationFrom(r.data);
      if (!auth) return { step, status: "FAILED", note: "replacement returned no authorization" };
      const now = new Date(nowMs);
      await prisma.load.update({ where: { id: loadId }, data: { authorizationId: auth.id, orderId: r.data.id, authorizedAt: now, lastAuthorizedAt: now, reauthCount: 0 } });
      return { step, status: "DONE", debugId: r.debugId, paypalId: auth.id, replayed: r.replayed };
    }
    case "CAPTURE": {
      const load = await getLoad(loadId);
      const authId = load.authorizationId!;
      // Amount comes from the engine plan only (prime directive). Key = (load, CAPTURE, auth): retries and double
      // clicks hit the same key (M8); a replacement authorization gets its own capture.
      const stage = `settle-${authId}`;
      const requestId = paypalRequestId(loadId, "CAPTURE", stage);
      const r = await recorded<Capture>({ loadId, operation: "CAPTURE", requestId, amountCents: step.cents }, () => captureFinal(loadId, authId, step.cents, stage));
      await prisma.load.update({ where: { id: loadId }, data: { captureId: r.data.id } });
      if (load.state === "SETTLING") await moveState(loadId, "SETTLING", "CAPTURED");
      return { step, status: "DONE", debugId: r.debugId, requestId, paypalId: r.data.id, replayed: r.replayed, note: r.data.status };
    }
    case "INVOICE_SHIPPER":
    case "INVOICE_CARRIER": {
      const load = await getLoad(loadId);
      const stage = step.do === "INVOICE_SHIPPER" ? "spill" : "carrier";
      const email = step.do === "INVOICE_SHIPPER" ? process.env.PAYPAL_SANDBOX_PERSONAL_EMAIL : load.carrier.verifiedPayeeEmail;
      if (!email) return { step, status: "SKIPPED", note: "no recipient email configured" };
      const requestId = paypalRequestId(loadId, "INVOICE", `create-${stage}`);
      const r = await recorded<{ id: string }>({ loadId, operation: `INVOICE_${stage.toUpperCase()}`, requestId, amountCents: step.cents }, async () => {
        const inv = await invoiceSpillover(loadId, email, step.cents, stage);
        return { ...inv.send, data: { id: inv.id } };
      });
      return { step, status: "DONE", debugId: r.debugId, requestId, paypalId: r.data.id, replayed: r.replayed };
    }
    case "PAYOUT_CARRIER": {
      // F1: verified payee only, cooling-off after an email change, per-load limit. M7: only reached after CAPTURE_COMPLETED.
      const load = await getLoad(loadId);
      const c = load.carrier;
      const verdict = checkPayout({ carrierId: c.id, receiverEmail: c.verifiedPayeeEmail, cents: step.cents, loadId }, {
        carrierId: c.id, usdot: c.usdot, legalName: c.name, payoutEmail: c.verifiedPayeeEmail,
        payoutEmailVerifiedAtMs: c.payeeVerifiedAt?.getTime() ?? null, payoutEmailChangedAtMs: c.payeeEmailChangedAt?.getTime() ?? null,
        status: c.status === "SUSPENDED" ? "SUSPENDED" : "ACTIVE",
      }, nowMs);
      if (!verdict.allowed) {
        await notify(loadId, "OPS", "BLOCKED", `payout blocked: ${verdict.reasons.join("; ")}`);
        return { step, status: "BLOCKED", note: verdict.reasons.join("; ") };
      }
      const requestId = paypalRequestId(loadId, "PAYOUT", "detention");
      const r = await recorded<PayoutBatch>({ loadId, operation: "PAYOUT", requestId, amountCents: step.cents, paypalIdOf: (d) => (d as PayoutBatch).batch_header?.payout_batch_id },
        () => payoutCarrier(loadId, c.verifiedPayeeEmail, step.cents));
      const batchId = r.data.batch_header?.payout_batch_id ?? null;
      if (batchId) await prisma.load.update({ where: { id: loadId }, data: { payoutBatchId: batchId } });
      return { step, status: "DONE", debugId: r.debugId, requestId, paypalId: batchId ?? undefined, replayed: r.replayed, note: r.data.batch_header?.batch_status };
    }
    case "SUBMIT_DISPUTE_EVIDENCE": {
      const load = await getLoad(loadId);
      const events: EvidenceEvent[] = load.evidence.map((e) => ({ source: e.source as EvidenceEvent["source"], kind: e.kind as EvidenceEvent["kind"], utcMs: e.utcAt.getTime(), confidence: e.confidence, citation: e.citation }));
      const pack = buildEvidencePack(plan, reconcileTimeline(events), `contract:${load.contractVersionId}`);
      const bytes = new TextEncoder().encode(pack.notes) as Uint8Array<ArrayBuffer>;
      const requestId = paypalRequestId(loadId, "EVIDENCE", step.disputeId);
      try {
        const r = await recorded({ loadId, operation: "EVIDENCE", requestId, paypalIdOf: () => step.disputeId },
          () => provideDisputeEvidence(step.disputeId, pack, [{ name: "dockclock-audit.txt", bytes, mime: "text/plain" }]));
        return { step, status: "DONE", debugId: r.debugId, requestId, paypalId: step.disputeId, replayed: r.replayed };
      } catch (e) {
        await notify(loadId, "OPS", "MANUAL_REVIEW", `evidence submission failed: ${(e as Error).message}`);
        return { step, status: "FAILED", note: (e as Error).message };
      }
    }
    case "WAIT_FOR_WEBHOOK":
      return { step, status: "DEFERRED", note: `waiting for ${step.event} (webhook, or worker poll after 60s)` };
    case "NOTIFY":
      await notify(loadId, step.who, "NOTIFY", step.message);
      return { step, status: "DONE", note: step.message };
    case "MANUAL_REVIEW":
      await notify(loadId, "OPS", "MANUAL_REVIEW", step.reason);
      return { step, status: "DEFERRED", note: step.reason };
    case "DONE":
      return { step, status: "DONE" };
  }
}
