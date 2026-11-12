import "server-only";
import { prisma, type Load } from "@dockclock/db";
import { transition, seedNetwork, recommendHold, DEMO_CONTRACT, type AccessorialContract, type LoadState, type HoldRecommendation, type EvidenceEvent } from "@dockclock/core";
import { DomainError } from "./http";

// Historical dwell for hold sizing: the deterministic synthetic network (labelled synthetic in UI).
let history: ReturnType<typeof seedNetwork>["history"] | null = null;
const getHistory = () => (history ??= seedNetwork(DEMO_CONTRACT).history);
/** Synthetic historical dwells at one facility (survival model input for offer pricing). */
export const facilityDwells = (facilityId: string) => getHistory().filter((h) => h.facilityId === facilityId).map((h) => h.dwellMin);

export function contractOf(terms: unknown): AccessorialContract {
  const c = terms as Partial<AccessorialContract>;
  if (c.currency !== "USD" || !Number.isInteger(c.ratePerIncrementCents)) throw new DomainError("bad_contract", "contract terms invalid or non-USD (M17)");
  return c as AccessorialContract;
}

export function localHour(ms: number, zone: string): number {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "numeric", hourCycle: "h23" }).format(ms));
}

export async function sizeHold(load: Load & { facility: { ianaZone: string }; contractVersion: { terms: unknown } }): Promise<HoldRecommendation> {
  return recommendHold(getHistory(), load.facilityId, localHour(load.appointmentAt.getTime(), load.facility.ianaZone), contractOf(load.contractVersion.terms));
}

export async function getLoad(id: string) {
  const l = await prisma.load.findUnique({ where: { id }, include: { facility: true, carrier: true, contractVersion: true, evidence: true } });
  if (!l) throw new DomainError("not_found", `load ${id} not found`);
  return l;
}

/**
 * Evidence rows -> core events. T15: the server clock decides, so anything stamped after `nowMs` (plus 5 min skew)
 * is ignored everywhere a timeline is built (a paper time from the future can never start or stop a clock).
 */
export function evidenceOf(load: { evidence: { source: string; kind: string; utcAt: Date; confidence: number; citation: string }[] }, nowMs = Date.now()): EvidenceEvent[] {
  return load.evidence.filter((e) => e.utcAt.getTime() <= nowMs + 5 * 60_000)
    .map((e) => ({ source: e.source as EvidenceEvent["source"], kind: e.kind as EvidenceEvent["kind"], utcMs: e.utcAt.getTime(), confidence: e.confidence, citation: e.citation }));
}

type LoadUpdate = Parameters<typeof prisma.load.updateMany>[0]["data"];

/** Forward-only move through the core state machine; conditional on the current state so concurrent writers cannot skip it. */
export async function moveState(id: string, from: LoadState, to: LoadState, data: LoadUpdate = {}) {
  transition(from, to);
  const r = await prisma.load.updateMany({ where: { id, state: from }, data: { ...data, state: to } });
  if (r.count !== 1) throw new DomainError("state_conflict", `load ${id} is not in ${from}`);
}
