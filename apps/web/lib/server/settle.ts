import "server-only";
import { prisma, sha256Json, type Prisma } from "@dockclock/db";
import { reconcileTimeline, planSettlement, applyAcceptedOffer, nextSteps, authState, type OfferKind, type EvidenceEvent, type Step, type LoadState, type SettlementPlan } from "@dockclock/core";
import { getLoad, contractOf, moveState } from "./loads";
import { runSteps, notify, type StepResult } from "./executor";
import { DomainError } from "./http";
import { lockedOfferFor } from "./negotiation";

export type { StepResult };

/** load -> reconcileTimeline -> planSettlement -> nextSteps(START) -> execute. Webhooks / worker continue from WAIT_FOR_WEBHOOK. */
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
  const metered = planSettlement({ loadId, appointmentMs: load.appointmentAt.getTime(), timeline, authorizedCents: load.holdCents, overcaptureEnabled: true }, contract);
  // An accepted shipper-funded agent offer (re-guarded at departure, A8) replaces metered detention: guaranteed price.
  // Evidence review still wins: weak evidence holds money even with an accepted offer.
  const locked = metered.action === "HOLD_FOR_REVIEW" ? null : await lockedOfferFor(loadId, nowMs);
  const plan = locked ? applyAcceptedOffer(metered, { id: locked.id, kind: locked.kind as OfferKind, priceCents: locked.priceCents }, load.holdCents, contract) : metered;
  const planRow = await savePlan(loadId, plan);

  // A human approving a review row (Phase 5 review queue) is the only way money moves on weak evidence.
  if (plan.action === "HOLD_FOR_REVIEW") {
    if (from === "DEPARTED") await moveState(loadId, "DEPARTED", "NEEDS_REVIEW");
    await notify(loadId, "OPS", "MANUAL_REVIEW", "evidence insufficient: settlement held for review");
    const steps: StepResult[] = [{ step: { do: "MANUAL_REVIEW", reason: "evidence insufficient" } as Step, status: "DEFERRED" }];
    return { plan, planHash: planRow.hash, planVersion: planRow.version, steps };
  }
  if (from !== "SETTLING") await moveState(loadId, from, "SETTLING");

  const auth = authState({ authorizationId: load.authorizationId, originalAuthorizedAtMs: load.authorizedAt.getTime(), lastAuthorizedAtMs: load.lastAuthorizedAt.getTime(), reauthCount: load.reauthCount }, nowMs);
  const steps = await runSteps(loadId, nextSteps(plan, auth, { type: "START" }), plan, nowMs);
  if (locked && steps.some((s) => s.step.do === "CAPTURE" && s.status === "DONE")) await prisma.offer.updateMany({ where: { id: locked.id, status: "ACCEPTED" }, data: { status: "SETTLED" } });
  return { plan, planHash: planRow.hash, planVersion: planRow.version, steps };
}

async function savePlan(loadId: string, plan: SettlementPlan) {
  const hash = sha256Json(plan);
  const last = await prisma.plan.findFirst({ where: { loadId }, orderBy: { version: "desc" } });
  if (last?.hash === hash) return last; // unchanged evidence => same plan version
  return prisma.plan.create({ data: { loadId, version: (last?.version ?? 0) + 1, hash, body: plan as unknown as Prisma.InputJsonValue } });
}
