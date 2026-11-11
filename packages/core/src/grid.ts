import type { SettlementPlan } from "./settlement";

/**
 * AG Grid / AG Studio data layer. Flat, typed rows with descriptions on every
 * field (AG Studio's AI uses field metadata to build widgets from prompts), plus
 * the facility scorecard that feeds the custom quadrant widget.
 * Column defs are plain objects so this file has no AG Grid dependency.
 */
export interface LedgerRow {
  loadId: string;
  facilityId: string;
  facilityName: string;
  carrierName: string;
  appointmentIso: string;
  arrivalClass: SettlementPlan["arrivalClass"];
  action: SettlementPlan["action"];
  dwellMin: number;
  billableMin: number;
  chargeUsd: number;
  capturedUsd: number;
  releasedUsd: number;
  invoicedUsd: number;
  carrierPayoutUsd: number;
  carrierOwesUsd: number;
  platformUsd: number;
  lineItemCount: number;
  needsReview: boolean;
  /** What the carrier claims is owed (from paper) — used to measure leakage on review rows. */
  claimedUsd: number;
  auditTrail: string;          // joined, for master/detail and tooltips
  paypalAuthorizationId: string | null;
  paypalCaptureId: string | null;
}

const d = (c: number) => Math.round(c) / 100;

export function toLedgerRow(plan: SettlementPlan, meta: { facilityId: string; facilityName: string; carrierName: string; appointmentMs: number; authorizationId?: string; captureId?: string; claimedUsd?: number }): LedgerRow {
  return {
    loadId: plan.loadId, facilityId: meta.facilityId, facilityName: meta.facilityName, carrierName: meta.carrierName,
    appointmentIso: new Date(meta.appointmentMs).toISOString(),
    arrivalClass: plan.arrivalClass, action: plan.action,
    dwellMin: plan.dwellMin, billableMin: plan.billableMin,
    chargeUsd: d(plan.chargeCents), capturedUsd: d(plan.captureCents), releasedUsd: d(plan.releasedCents),
    invoicedUsd: d(plan.invoiceCents), carrierPayoutUsd: d(plan.driverPayoutCents), carrierOwesUsd: d(plan.carrierInvoiceCents),
    platformUsd: d(plan.platformRetainedCents), lineItemCount: plan.lineItems.length,
    needsReview: plan.action === "HOLD_FOR_REVIEW", claimedUsd: meta.claimedUsd ?? d(plan.chargeCents), auditTrail: plan.audit.join("\n"),
    paypalAuthorizationId: meta.authorizationId ?? null, paypalCaptureId: meta.captureId ?? null,
  };
}

/** Field descriptions for AgDataSourcesDefinition — this is what makes the Studio AI answer well. */
export const LEDGER_FIELD_DESCRIPTIONS: Record<keyof LedgerRow, string> = {
  loadId: "Unique load/shipment identifier",
  facilityId: "Warehouse or terminal id where the truck waited",
  facilityName: "Warehouse or terminal name",
  carrierName: "Trucking company that hauled the load",
  appointmentIso: "Scheduled dock appointment (UTC)",
  arrivalClass: "EARLY, ON_TIME, LATE relative to appointment + grace",
  action: "Settlement outcome on PayPal: VOID, CAPTURE, CAPTURE_AND_INVOICE, HOLD_FOR_REVIEW",
  dwellMin: "Minutes on site counted by the detention clock",
  billableMin: "Minutes billed after free time and carrier-caused delay",
  chargeUsd: "Total owed by the shipper (detention + shipper line items), USD",
  capturedUsd: "Captured from the PayPal authorization hold, USD",
  releasedUsd: "Uncaptured hold released back to the shipper, USD",
  invoicedUsd: "Billed by PayPal invoice above the capture ceiling, USD",
  carrierPayoutUsd: "Paid to the carrier via PayPal Payouts, USD",
  carrierOwesUsd: "Carrier liabilities exceeding its earnings, invoiced to the carrier, USD",
  platformUsd: "Platform fee retained, USD",
  lineItemCount: "Number of damage, seal, cold-chain or hardware line items",
  needsReview: "True when evidence was insufficient and money did not move automatically",
  claimedUsd: "Amount the carrier claims on paper; for review rows this is revenue at risk, USD",
  auditTrail: "Step-by-step deterministic explanation of the settlement",
  paypalAuthorizationId: "PayPal authorization id of the hold",
  paypalCaptureId: "PayPal capture id",
};

export const LEDGER_COLUMN_DEFS = [
  { field: "loadId", pinned: "left", cellRenderer: "agGroupCellRenderer", filter: "agTextColumnFilter" },
  { field: "facilityName", rowGroup: false, enableRowGroup: true, filter: "agSetColumnFilter" },
  { field: "carrierName", enableRowGroup: true, filter: "agSetColumnFilter" },
  { field: "action", enableRowGroup: true, cellRenderer: "actionBadgeRenderer", filter: "agSetColumnFilter" },
  { field: "arrivalClass", enableRowGroup: true },
  { field: "dwellMin", type: "numericColumn", aggFunc: "avg", filter: "agNumberColumnFilter" },
  { field: "billableMin", type: "numericColumn", aggFunc: "sum" },
  { field: "chargeUsd", type: "numericColumn", aggFunc: "sum", valueFormatter: "usd" },
  { field: "capturedUsd", type: "numericColumn", aggFunc: "sum", valueFormatter: "usd" },
  { field: "releasedUsd", type: "numericColumn", aggFunc: "sum", valueFormatter: "usd" },
  { field: "invoicedUsd", type: "numericColumn", aggFunc: "sum", valueFormatter: "usd" },
  { field: "carrierPayoutUsd", type: "numericColumn", aggFunc: "sum", valueFormatter: "usd" },
  { field: "carrierOwesUsd", type: "numericColumn", aggFunc: "sum", valueFormatter: "usd" },
  { field: "needsReview", cellRenderer: "reviewToggleRenderer", editable: true },
  { field: "paypalCaptureId", cellRenderer: "paypalLinkRenderer" },
] as const;

export interface FacilityScore {
  facilityId: string; facilityName: string; loads: number;
  avgDwellMin: number; detentionRate: number; recoveryRate: number; capturedUsd: number;
  quadrant: "FAST_AND_FAIR" | "SLOW_BUT_PAYS" | "FAST_BUT_DISPUTES" | "REVENUE_LEAK";
}

/** X = avg dwell, Y = recovery rate (captured / owed). Thresholds = network medians. */
export function facilityScorecard(rows: LedgerRow[]): FacilityScore[] {
  const by = new Map<string, LedgerRow[]>();
  for (const r of rows) by.set(r.facilityId, [...(by.get(r.facilityId) ?? []), r]);
  const raw = [...by.values()].map((rs) => {
    const owed = rs.reduce((s, r) => s + Math.max(r.chargeUsd, r.claimedUsd), 0);
    const cap = rs.reduce((s, r) => s + r.capturedUsd, 0);
    return {
      facilityId: rs[0]!.facilityId, facilityName: rs[0]!.facilityName, loads: rs.length,
      avgDwellMin: Math.round(rs.reduce((s, r) => s + r.dwellMin, 0) / rs.length),
      detentionRate: Number((rs.filter((r) => r.chargeUsd > 0).length / rs.length).toFixed(3)),
      recoveryRate: owed > 0 ? Number((cap / owed).toFixed(3)) : 1,
      capturedUsd: Math.round(cap * 100) / 100,
    };
  });
  const med = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] ?? 0; };
  const mD = med(raw.map((r) => r.avgDwellMin)), mR = med(raw.map((r) => r.recoveryRate));
  return raw.map((r) => ({
    ...r,
    quadrant: r.avgDwellMin <= mD ? (r.recoveryRate >= mR ? "FAST_AND_FAIR" : "FAST_BUT_DISPUTES") : (r.recoveryRate >= mR ? "SLOW_BUT_PAYS" : "REVENUE_LEAK"),
  }));
}
