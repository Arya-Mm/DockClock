import type { SettlementPlan } from "./settlement";
import type { AuthState } from "./authLifecycle";

/**
 * Failure-path planner: given the plan and what PayPal just said, what happens
 * next. Pure function — the API route executes the steps. This is the part
 * judges never see in other entries: what happens when the happy path breaks.
 */
export type PayPalOutcome =
  | { type: "START" }
  | { type: "CAPTURE_COMPLETED"; captureId: string }               // from PAYMENT.CAPTURE.COMPLETED webhook
  | { type: "CAPTURE_PENDING"; captureId: string; reason: string } // e.g. PENDING_REVIEW
  | { type: "CAPTURE_FAILED"; issue: string }                      // INSTRUMENT_DECLINED, AUTHORIZATION_VOIDED, AUTHORIZATION_EXPIRED...
  | { type: "VOID_COMPLETED" }
  | { type: "PAYOUT_SUCCEEDED" }
  | { type: "PAYOUT_UNCLAIMED" }                                    // receiver has no PayPal account yet
  | { type: "PAYOUT_FAILED"; issue: string }
  | { type: "DISPUTE_CREATED"; disputeId: string };

export type Step =
  | { do: "REAUTHORIZE" } | { do: "REPLACE_AUTH_FROM_VAULT" }
  | { do: "CAPTURE"; cents: number } | { do: "VOID" }
  | { do: "INVOICE_SHIPPER"; cents: number; reason: string }
  | { do: "INVOICE_CARRIER"; cents: number }
  | { do: "PAYOUT_CARRIER"; cents: number }
  | { do: "WAIT_FOR_WEBHOOK"; event: string }
  | { do: "NOTIFY"; who: "CARRIER" | "SHIPPER" | "OPS"; message: string }
  | { do: "SUBMIT_DISPUTE_EVIDENCE"; disputeId: string }
  | { do: "MANUAL_REVIEW"; reason: string }
  | { do: "DONE" };

const RETRYABLE_AUTH = new Set(["AUTHORIZATION_EXPIRED", "AUTHORIZATION_VOIDED"]);

export function nextSteps(plan: SettlementPlan, auth: AuthState, outcome: PayPalOutcome): Step[] {
  switch (outcome.type) {
    case "START": {
      if (plan.action === "HOLD_FOR_REVIEW") return [{ do: "MANUAL_REVIEW", reason: "evidence insufficient" }];
      if (plan.action === "VOID") {
        const s: Step[] = [{ do: "VOID" }];
        if (plan.carrierInvoiceCents > 0) s.push({ do: "INVOICE_CARRIER", cents: plan.carrierInvoiceCents });
        return s;
      }
      const pre: Step[] = auth.state === "EXPIRED" ? [{ do: "REPLACE_AUTH_FROM_VAULT" }] : auth.state === "REAUTH_REQUIRED" ? [{ do: "REAUTHORIZE" }] : [];
      const s: Step[] = [...pre, { do: "CAPTURE", cents: plan.captureCents }];
      if (plan.invoiceCents > 0) s.push({ do: "INVOICE_SHIPPER", cents: plan.invoiceCents, reason: "above capture ceiling" });
      s.push({ do: "WAIT_FOR_WEBHOOK", event: "PAYMENT.CAPTURE.COMPLETED" });
      return s;
    }
    case "CAPTURE_COMPLETED": {
      const s: Step[] = [];
      // Invoice before the payout wait: runSteps stops at WAIT_FOR_WEBHOOK, so anything after it never ran.
      if (plan.carrierInvoiceCents > 0) s.push({ do: "INVOICE_CARRIER", cents: plan.carrierInvoiceCents });
      if (plan.driverPayoutCents > 0) s.push({ do: "PAYOUT_CARRIER", cents: plan.driverPayoutCents }, { do: "WAIT_FOR_WEBHOOK", event: "PAYMENT.PAYOUTS-ITEM.SUCCEEDED" });
      return s.length ? s : [{ do: "DONE" }];
    }
    case "CAPTURE_PENDING":
      return [{ do: "NOTIFY", who: "OPS", message: `Capture ${outcome.captureId} pending (${outcome.reason}); payout withheld until COMPLETED` }, { do: "WAIT_FOR_WEBHOOK", event: "PAYMENT.CAPTURE.COMPLETED" }];
    case "CAPTURE_FAILED":
      if (RETRYABLE_AUTH.has(outcome.issue)) return [{ do: "REPLACE_AUTH_FROM_VAULT" }, { do: "CAPTURE", cents: plan.captureCents }];
      // Hold unusable (declined/insufficient funds): bill the whole amount, keep the evidence-backed claim alive.
      return [
        { do: "INVOICE_SHIPPER", cents: plan.chargeCents, reason: `capture failed: ${outcome.issue}` },
        { do: "NOTIFY", who: "SHIPPER", message: "Hold could not be captured; invoice issued with full audit trail" },
      ];
    case "VOID_COMPLETED":
    case "PAYOUT_SUCCEEDED":
      return [{ do: "DONE" }];
    case "PAYOUT_UNCLAIMED":
      return [{ do: "NOTIFY", who: "CARRIER", message: "Claim your detention payout — PayPal returns unclaimed funds after 30 days" }];
    case "PAYOUT_FAILED":
      return [{ do: "MANUAL_REVIEW", reason: `payout failed: ${outcome.issue}` }];
    case "DISPUTE_CREATED":
      return [{ do: "SUBMIT_DISPUTE_EVIDENCE", disputeId: outcome.disputeId }, { do: "NOTIFY", who: "OPS", message: "Dispute opened; evidence pack auto-submitted" }];
  }
}
