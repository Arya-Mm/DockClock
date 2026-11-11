import { createHash } from "node:crypto";

/**
 * Load state machine. Money-moving calls are only reachable from specific
 * states, and every transition is persisted BEFORE the PayPal call returns
 * control to the UI — so a double-click, retry or webhook replay cannot
 * capture or pay out twice.
 */
export type LoadState =
  | "DISPATCHED" | "AWAITING_PAYER" | "AUTHORIZED" | "AT_FACILITY" | "DEPARTED"
  | "NEEDS_REVIEW" | "SETTLING" | "CAPTURED" | "VOIDED" | "PAID_OUT" | "INVOICED_SPILLOVER" | "DISPUTED";

const ALLOWED: Record<LoadState, LoadState[]> = {
  DISPATCHED: ["AWAITING_PAYER", "AUTHORIZED"],     // AUTHORIZED directly when payer is vaulted
  AWAITING_PAYER: ["AUTHORIZED"],
  AUTHORIZED: ["AT_FACILITY", "VOIDED"],
  AT_FACILITY: ["DEPARTED"],
  DEPARTED: ["SETTLING", "NEEDS_REVIEW"],
  NEEDS_REVIEW: ["SETTLING", "VOIDED"],
  SETTLING: ["CAPTURED", "VOIDED", "NEEDS_REVIEW"],
  CAPTURED: ["PAID_OUT", "INVOICED_SPILLOVER", "DISPUTED"],
  PAID_OUT: ["INVOICED_SPILLOVER", "DISPUTED"],
  INVOICED_SPILLOVER: ["PAID_OUT", "DISPUTED"],
  VOIDED: [],
  DISPUTED: [],
};

export function transition(from: LoadState, to: LoadState): LoadState {
  if (!ALLOWED[from].includes(to)) throw new Error(`Illegal transition ${from} → ${to}`);
  return to;
}

/**
 * Idempotency key = (loadId, operation, stage). Deliberately NOT the amount:
 * if a capture succeeded but its response was lost and the plan is later
 * recomputed with a different amount, an amount-derived key would let a second
 * capture through. One stage => one key => PayPal returns the original result.
 * PayPal-Request-Id max length is 108 chars.
 */
export type PayPalOp = "ORDER" | "AUTHORIZE" | "REAUTHORIZE" | "CAPTURE" | "VOID" | "PAYOUT" | "INVOICE" | "REFUND" | "EVIDENCE";
export function paypalRequestId(loadId: string, op: PayPalOp, stage: string | number): string {
  return "dc-" + createHash("sha256").update(`${loadId}|${op}|${stage}`).digest("hex").slice(0, 40);
}

/** PayPal money strings: always "81.25", never 81.25 or "81.2". */
export function centsToPayPal(cents: number): string {
  if (!Number.isInteger(cents) || cents < 0) throw new Error(`bad cents ${cents}`);
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}
