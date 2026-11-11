import { DAY } from "./time.js";

/**
 * Payout fraud controls. Freight's #1 fraud pattern is double-brokering and
 * payment-redirect ("please send this load's money to our new email").
 * Money only goes to the payee verified at onboarding; a recent payee change
 * freezes payouts for a cooling-off window and requires out-of-band confirmation.
 */
export interface CarrierProfile {
  carrierId: string;
  /** US DOT / MC number — format-checked here; verify against FMCSA in production. */
  usdot: string;
  legalName: string;
  payoutEmail: string;
  payoutEmailVerifiedAtMs: number | null;
  payoutEmailChangedAtMs: number | null;
  status: "ACTIVE" | "SUSPENDED";
}

export interface PayoutRequest { carrierId: string; receiverEmail: string; cents: number; loadId: string }

export function checkPayout(req: PayoutRequest, carrier: CarrierProfile | undefined, nowMs: number,
  opts: { coolingOffMs?: number; perLoadLimitCents?: number } = {}): { allowed: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const cooling = opts.coolingOffMs ?? 3 * DAY;
  const limit = opts.perLoadLimitCents ?? 75_000;
  if (!carrier) return { allowed: false, reasons: ["carrier not onboarded"] };
  if (carrier.status !== "ACTIVE") reasons.push("carrier suspended");
  if (!/^\d{5,8}$/.test(carrier.usdot)) reasons.push("USDOT number malformed");
  if (req.carrierId !== carrier.carrierId) reasons.push("carrier mismatch");
  if (req.receiverEmail.trim().toLowerCase() !== carrier.payoutEmail.trim().toLowerCase()) reasons.push("receiver differs from verified payout email (payment-redirect pattern)");
  if (!carrier.payoutEmailVerifiedAtMs) reasons.push("payout email never verified");
  if (carrier.payoutEmailChangedAtMs && nowMs - carrier.payoutEmailChangedAtMs < cooling) reasons.push("payout email changed within cooling-off window");
  if (!Number.isInteger(req.cents) || req.cents <= 0) reasons.push("invalid amount");
  if (req.cents > limit) reasons.push(`amount above per-load limit $${(limit / 100).toFixed(2)} — needs approval`);
  return { allowed: reasons.length === 0, reasons };
}
