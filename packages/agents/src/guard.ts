import { OFFER_FUNDER, type OfferKind } from "@dockclock/core";
import type { AgentKind, Mandate } from "./schemas";

export interface GuardInput {
  mandate: Mandate | null;
  agent: AgentKind;
  kind: OfferKind;
  counterparty: string;
  cents: number;
  /** Sum of ALLOWED amounts this mandate already spent today (UTC day). */
  spentTodayCents: number;
  /** PayPal capture ceiling of the shipper's hold; required for shipper-funded actions. */
  holdCeilingCents: number | null;
  /** Money going to the carrier must land on its verified payout profile (F1). */
  payee: { email: string | null; verified: boolean } | null;
  offer: { expiresAtMs: number; version: number; planHash: string };
  current: { version: number; planHash: string } | null;
  nowMs: number;
}

export type GuardCode =
  | "NO_MANDATE" | "REVOKED" | "EXPIRED_MANDATE" | "OUT_OF_SCOPE" | "COUNTERPARTY" | "PER_ACTION_CAP" | "DAILY_CAP"
  | "HOLD_CEILING" | "PAYEE" | "OFFER_EXPIRED" | "STALE_OFFER";

export interface GuardVerdict { verdict: "ALLOWED" | "BLOCKED" | "ESCALATED"; codes: GuardCode[]; reasons: string[] }

const usd = (c: number) => `$${(c / 100).toFixed(2)}`;
/** Caps are a policy limit a human may lift; every other failure is a hard block. */
const ESCALATABLE: ReadonlySet<GuardCode> = new Set(["PER_ACTION_CAP", "DAILY_CAP"]);

/**
 * Mandate guard (PLAN §4.5): checks run in the plan's order; every failure is reported.
 * Code decides; no LLM output reaches this function. Called at accept AND again at execution (A8).
 */
export function checkMandate(i: GuardInput): GuardVerdict {
  const m = i.mandate;
  if (!m) return { verdict: "BLOCKED", codes: ["NO_MANDATE"], reasons: ["no mandate for this agent"] };
  const fail: [GuardCode, string][] = [];
  if (m.agent !== i.agent) fail.push(["NO_MANDATE", `mandate ${m.id} belongs to ${m.agent}, not ${i.agent}`]);
  if (m.revokedAtMs !== null && m.revokedAtMs <= i.nowMs) fail.push(["REVOKED", `mandate ${m.id} revoked`]);
  if (m.expiresAtMs <= i.nowMs) fail.push(["EXPIRED_MANDATE", `mandate ${m.id} expired`]);
  if (!m.allowedActions.includes(i.kind)) fail.push(["OUT_OF_SCOPE", `${i.kind} not in mandate scope`]);
  if (!m.counterparties.includes(i.counterparty) && !m.counterparties.includes("*")) fail.push(["COUNTERPARTY", `counterparty ${i.counterparty} not allowed`]);
  if (!Number.isInteger(i.cents) || i.cents < 0) fail.push(["PER_ACTION_CAP", "amount is not a non-negative integer of cents"]);
  else if (i.cents > m.perActionCapCents) fail.push(["PER_ACTION_CAP", `${usd(i.cents)} over per-action cap ${usd(m.perActionCapCents)}`]);
  if (i.spentTodayCents + i.cents > m.dailyCapCents) fail.push(["DAILY_CAP", `${usd(i.spentTodayCents + i.cents)} today over daily cap ${usd(m.dailyCapCents)}`]);
  if (OFFER_FUNDER[i.kind] === "SHIPPER" && (i.holdCeilingCents === null || i.cents > i.holdCeilingCents)) {
    fail.push(["HOLD_CEILING", i.holdCeilingCents === null ? "no PayPal hold funds this" : `${usd(i.cents)} over hold capture ceiling ${usd(i.holdCeilingCents)}`]);
  }
  if (OFFER_FUNDER[i.kind] !== "CARRIER" && (!i.payee || !i.payee.verified || !i.payee.email)) fail.push(["PAYEE", "payee is not the carrier's verified payout profile"]);
  if (i.offer.expiresAtMs <= i.nowMs) fail.push(["OFFER_EXPIRED", "offer TTL passed"]);
  if (!i.current || i.current.version !== i.offer.version || i.current.planHash !== i.offer.planHash) fail.push(["STALE_OFFER", "offer version/planHash no longer current (A3)"]);
  if (!fail.length) return { verdict: "ALLOWED", codes: [], reasons: [] };
  const codes = fail.map((f) => f[0]);
  return { verdict: codes.every((c) => ESCALATABLE.has(c)) ? "ESCALATED" : "BLOCKED", codes, reasons: fail.map((f) => f[1]) };
}
