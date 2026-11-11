import "server-only";
import { prisma, sha256Json, type Prisma } from "@dockclock/db";
import { reconcileTimeline, planSettlement, nextSteps, authState, paypalRequestId, type EvidenceEvent, type Step, type LoadState, type SettlementPlan } from "@dockclock/core";
import { captureFinal, invoiceSpillover, type Capture } from "@dockclock/paypal";
import { recorded } from "./ops";
import { getLoad, contractOf, moveState } from "./loads";
import { reauthorizeHold, voidLoadHold } from "./holds";
import { DomainError } from "./http";

export interface StepResult { step: Step; status: "DONE" | "DEFERRED" | "FAILED" | "SKIPPED"; debugId?: string | null; requestId?: string; paypalId?: string; replayed?: boolean; note?: string }

/** PayPal says nothing about a hold until a capture moves money; webhooks (Phase 2) continue from WAIT_FOR_WEBHOOK. */
export async function settleLoad(loadId: string, nowMs = Date.now()) {
  const load = await getLoad(loadId);
  const from = load.state as LoadState;
  if (from !== "DEPARTED" && from !== "NEEDS_REVIEW" && from !== "SETTLING") throw new DomainError("state_conflict", `cannot settle from ${from} (T10: no departure, no settlement)`);
  if (!load.authorizationId || !load.holdCents || !load.authorizedAt || !load.lastAuthorizedAt) throw new DomainError("no_hold", "load has no authorization");

  const events: EvidenceEvent[] = load.evidence.map((e) => ({
    source: e.source as EvidenceEvent["source"], kind: e.kind as EvidenceEvent["kind"], utcMs: e.utcAt.getTime(), confidence: e.confidence, citation: e.citation,
  }));
  const timeline = reconcileTimeline(events);
  const contract = contractOf(load.contractVersion.terms);
  const plan = planSettlement({ loadId, appointmentMs: load.appointmentAt.getTime(), timeline, authorizedCents: load.holdCents, overcaptureEnabled: true }, contract);
  const planRow = await savePlan(loadId, plan);

  // A human approving a review row passes approved=true later (Phase 5 review queue); here review stays review.
  if (plan.action === "HOLD_FOR_REVIEW") {
    if (from === "DEPARTED") await moveState(loadId, "DEPARTED", "NEEDS_REVIEW");
    return { plan, planHash: planRow.hash, planVersion: planRow.version, steps: [{ step: { do: "MANUAL_REVIEW", reason: "evidence insufficient" } as Step, status: "DEFERRED" as const }] };
  }
  if (from !== "SETTLING") await moveState(loadId, from, "SETTLING");

  const auth = authState({ authorizationId: load.authorizationId, originalAuthorizedAtMs: load.authorizedAt.getTime(), lastAuthorizedAtMs: load.lastAuthorizedAt.getTime(), reauthCount: load.reauthCount }, nowMs);
  const steps = nextSteps(plan, auth, { type: "START" });
  const results: StepResult[] = [];
  for (const step of steps) {
    const r = await runStep(loadId, step, plan, nowMs);
    results.push(r);
    if (r.status === "FAILED" || r.status === "DEFERRED") break; // later steps depend on this one
  }
  return { plan, planHash: planRow.hash, planVersion: planRow.version, steps: results };
}

async function savePlan(loadId: string, plan: SettlementPlan) {
  const hash = sha256Json(plan);
  const last = await prisma.plan.findFirst({ where: { loadId }, orderBy: { version: "desc" } });
  if (last?.hash === hash) return last; // unchanged evidence => same plan version
  return prisma.plan.create({ data: { loadId, version: (last?.version ?? 0) + 1, hash, body: plan as unknown as Prisma.InputJsonValue } });
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
    case "CAPTURE": {
      const load = await getLoad(loadId);
      const authId = load.authorizationId!;
      // Amount comes from the engine plan only (prime directive). One stage => one request id (M8).
      const requestId = paypalRequestId(loadId, "CAPTURE", "settle");
      const r = await recorded<Capture>({ loadId, operation: "CAPTURE", requestId, amountCents: step.cents }, () => captureFinal(loadId, authId, step.cents, "settle"));
      if (load.state === "SETTLING") await moveState(loadId, "SETTLING", "CAPTURED");
      return { step, status: "DONE", debugId: r.debugId, requestId, paypalId: r.data.id, replayed: r.replayed, note: r.data.status };
    }
    case "INVOICE_SHIPPER": {
      const email = process.env.PAYPAL_SANDBOX_PERSONAL_EMAIL;
      if (!email) return { step, status: "SKIPPED", note: "PAYPAL_SANDBOX_PERSONAL_EMAIL not set" };
      const requestId = paypalRequestId(loadId, "INVOICE", "create");
      const r = await recorded({ loadId, operation: "INVOICE", requestId, amountCents: step.cents }, async () => {
        const inv = await invoiceSpillover(loadId, email, step.cents);
        return { ...inv.send, data: { id: inv.id } };
      });
      return { step, status: "DONE", debugId: r.debugId, requestId, paypalId: r.data.id, replayed: r.replayed };
    }
    case "WAIT_FOR_WEBHOOK":
      return { step, status: "DEFERRED", note: `waiting for ${step.event} (Phase 2 webhook + 60s poll fallback)` };
    case "INVOICE_CARRIER":
    case "PAYOUT_CARRIER":
    case "REPLACE_AUTH_FROM_VAULT":
    case "SUBMIT_DISPUTE_EVIDENCE":
    case "NOTIFY":
      return { step, status: "DEFERRED", note: "handled by worker (Phase 2)" };
    case "MANUAL_REVIEW":
      return { step, status: "DEFERRED", note: step.reason };
    case "DONE":
      return { step, status: "DONE" };
  }
}

export { type SettlementPlan };
