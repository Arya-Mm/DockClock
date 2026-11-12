import "server-only";
import { facilityScorecard, type FacilityScore } from "@dockclock/core";
import { ledgerRows, agentRows } from "./server/cockpit";

/**
 * AG Studio data for the DockClock dashboard (PLAN §7.1). Flat rows of engine output; the seeded network is labelled
 * "Synthetic" in the `source` field so every widget can split or filter it out.
 */
export interface StudioLedgerRow {
  loadId: string; facilityId: string; facilityName: string; carrierName: string; appointment: string; week: string;
  arrivalClass: string; action: string; state: string; source: "Synthetic" | "Live sandbox"; needsReview: boolean;
  dwellMin: number; billableMin: number; chargeUsd: number; capturedUsd: number; releasedUsd: number; invoicedUsd: number;
  carrierPayoutUsd: number; claimedUsd: number; leakageUsd: number;
}
export interface StudioFacilityRow extends FacilityScore { leakageUsd: number; quadrantLabel: string }
export interface StudioAgentRow { seq: number; agent: string; action: string; verdict: string; reason: string; amountUsd: number; mandateId: string; createdAt: string }
export interface StudioData { asOf: string; ledger: StudioLedgerRow[]; facilities: StudioFacilityRow[]; agentActions: StudioAgentRow[] }

export const QUADRANT_LABELS: Record<FacilityScore["quadrant"], string> = {
  FAST_AND_FAIR: "Fast and fair", SLOW_BUT_PAYS: "Slow but pays", FAST_BUT_DISPUTES: "Fast but disputes", REVENUE_LEAK: "Revenue leak",
};

export async function getStudioData(): Promise<StudioData> {
  const [rows, actions] = await Promise.all([ledgerRows(), agentRows()]);
  const ledger: StudioLedgerRow[] = rows.map((r) => ({
    loadId: r.loadId, facilityId: r.facilityId, facilityName: r.facilityName, carrierName: r.carrierName, appointment: r.appointmentIso, week: r.week,
    arrivalClass: r.arrivalClass, action: r.action, state: r.state, source: r.synthetic ? "Synthetic" : "Live sandbox", needsReview: r.needsReview,
    dwellMin: r.dwellMin, billableMin: r.billableMin, chargeUsd: r.chargeUsd, capturedUsd: r.capturedUsd, releasedUsd: r.releasedUsd, invoicedUsd: r.invoicedUsd,
    carrierPayoutUsd: r.carrierPayoutUsd, claimedUsd: r.claimedUsd, leakageUsd: r.leakageUsd,
  }));
  const leakBy = new Map<string, number>();
  for (const r of rows) leakBy.set(r.facilityId, (leakBy.get(r.facilityId) ?? 0) + r.leakageUsd);
  const facilities = facilityScorecard(rows).map((f) => ({ ...f, leakageUsd: Math.round((leakBy.get(f.facilityId) ?? 0) * 100) / 100, quadrantLabel: QUADRANT_LABELS[f.quadrant] }));
  const agentActions: StudioAgentRow[] = actions.map((a) => ({
    seq: a.seq, agent: a.agent, action: a.action, verdict: a.verdict,
    // First reason, without the amount, so "by reason" groups cleanly.
    reason: a.reasons ? a.reasons.split("; ")[0]!.replace(/\$[\d,.]+\s*/g, "").replace(/\s{2,}/g, " ").replace(/^today /, "").trim().slice(0, 80) : "none",
    amountUsd: a.cents === null ? 0 : a.cents / 100, mandateId: a.mandateId ?? "none", createdAt: a.createdAt,
  }));
  return { asOf: new Date().toISOString(), ledger, facilities, agentActions };
}
