import "server-only";
import { prisma } from "@dockclock/db";
import { breakEvenDwellMin, chargeForDwell, reconcileTimeline, type SettlementPlan } from "@dockclock/core";
import { contractOf, evidenceOf } from "./loads";
import { DomainError } from "./http";

/**
 * Bryntum dock board data (PLAN §7.2). Resources = dock doors, events = trucks (arrival to departure, or to now while
 * still at the door). Every money number is engine output: the saved plan's charge, or chargeForDwell for a live bar.
 */
export const DOORS = ["D-1", "D-2", "D-3", "D-4", "D-5", "D-6"] as const;

export interface DockEvent {
  id: string; resourceId: string; startDate: string; endDate: string; name: string; carrierName: string;
  state: string; synthetic: boolean; atDock: boolean; dwellMin: number; chargeCents: number;
  breakEvenMin: number; tonuCents: number; swapped: boolean;
}
export interface DockBoard { facilityId: string; facilityName: string; facilities: { id: string; name: string }[]; doors: { id: string; name: string }[]; events: DockEvent[]; serverNowMs: number }

// Stable door per load when no swap has assigned one (doors are not modelled on Load yet).
const doorOf = (loadId: string) => DOORS[[...loadId].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7) % DOORS.length]!;

const WINDOW_MS = 36 * 3_600_000;

export async function dockBoard(facilityId: string | null, nowMs = Date.now()): Promise<DockBoard> {
  const facilities = await prisma.facility.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } });
  if (!facilities.length) throw new DomainError("not_found", "no facilities seeded");
  // Default: the facility with the most real loads, so the board opens on live sandbox data.
  const busiest = facilityId ? null : await prisma.load.groupBy({ by: ["facilityId"], where: { synthetic: false }, _count: true, orderBy: { _count: { facilityId: "desc" } }, take: 1 });
  const fid = facilityId ?? busiest?.[0]?.facilityId ?? facilities[0]!.id;
  const facility = facilities.find((f) => f.id === fid);
  if (!facility) throw new DomainError("not_found", `facility ${fid} not found`);
  const loads = await prisma.load.findMany({
    where: { facilityId: fid, appointmentAt: { gte: new Date(nowMs - WINDOW_MS), lte: new Date(nowMs + WINDOW_MS) } },
    orderBy: [{ synthetic: "asc" }, { appointmentAt: "desc" }], take: 60,
    include: { carrier: true, contractVersion: true, evidence: true, plans: { orderBy: { version: "desc" }, take: 1 },
      offers: { where: { status: "ACCEPTED", slotDoorId: { not: null } }, orderBy: { acceptedAt: "desc" }, take: 1 } },
  });
  const events = loads.flatMap((l): DockEvent[] => {
    const c = contractOf(l.contractVersion.terms);
    const t = reconcileTimeline(evidenceOf(l, nowMs));
    const start = t.arrivalMs ?? l.appointmentAt.getTime();
    const atDock = t.departureMs === null && t.arrivalMs !== null;
    if (t.arrivalMs === null && t.departureMs === null && l.appointmentAt.getTime() < nowMs - 3_600_000) return []; // never showed
    if (l.synthetic && atDock) return []; // seed rows never get a departure; only real trucks are live at a door
    const end = t.departureMs ?? (atDock ? Math.max(nowMs, start + 15 * 60_000) : start + 60 * 60_000);
    const dwellMin = Math.max(0, Math.round((end - start) / 60_000));
    const plan = l.plans[0]?.body as unknown as SettlementPlan | undefined;
    const swap = l.offers[0];
    return [{ id: l.id, resourceId: swap?.slotDoorId ?? doorOf(l.id), startDate: new Date(start).toISOString(), endDate: new Date(end).toISOString(),
      name: l.id, carrierName: l.carrier.name, state: l.state, synthetic: l.synthetic, atDock, dwellMin,
      chargeCents: plan && !atDock ? plan.chargeCents : chargeForDwell(dwellMin, c), breakEvenMin: breakEvenDwellMin(c), tonuCents: c.tonuFlatCents, swapped: !!swap }];
  });
  return { facilityId: fid, facilityName: facility.name, facilities, doors: DOORS.map((d) => ({ id: d, name: `Door ${d.slice(2)}` })), events, serverNowMs: nowMs };
}

/** Live re-price for a hand-dragged bar. Read-only: nothing is saved and no money moves (PLAN §7.2). */
export async function previewMove(loadId: string, newEndMs: number, nowMs = Date.now()) {
  const l = await prisma.load.findUnique({ where: { id: loadId }, include: { contractVersion: true, evidence: true } });
  if (!l) throw new DomainError("not_found", `load ${loadId} not found`);
  const c = contractOf(l.contractVersion.terms);
  const t = reconcileTimeline(evidenceOf(l, nowMs));
  // The arrival is a fact; a drag only moves when the door frees the truck.
  const arrival = t.arrivalMs ?? l.appointmentAt.getTime();
  const currentEnd = t.departureMs ?? Math.max(nowMs, arrival);
  const dwell = (ms: number) => Math.max(0, Math.round((ms - arrival) / 60_000));
  const before = chargeForDwell(dwell(currentEnd), c), after = chargeForDwell(dwell(newEndMs), c);
  return { loadId, dwellMinBefore: dwell(currentEnd), dwellMinAfter: dwell(newEndMs), chargeCentsBefore: before, chargeCentsAfter: after,
    deltaCents: after - before, breakEvenMin: breakEvenDwellMin(c), tonuCents: c.tonuFlatCents, overBreakEven: dwell(newEndMs) > breakEvenDwellMin(c) };
}
