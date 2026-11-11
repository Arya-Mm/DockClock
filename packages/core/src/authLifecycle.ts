import { DAY } from "./time.js";

/**
 * PayPal authorization clock (Orders v2 / Payments v2):
 *  - Auth valid 29 days from ORIGINAL authorization.
 *  - Honor period: 3 days from the latest (re)authorization.
 *  - Reauthorize is only allowed AFTER the honor period has expired, and it
 *    returns a NEW authorization id that must be used for capture.
 *  - After day 29: create a new authorization (vaulted payer => no buyer needed).
 *
 * The Gemini plan reauthorized at hour 68 (inside the honor period) — PayPal
 * rejects that. This module is the single source of truth for what is legal now.
 */
export interface AuthRecord {
  authorizationId: string;
  originalAuthorizedAtMs: number;
  lastAuthorizedAtMs: number; // = original unless reauthorized
  /** PayPal docs conflict on multiple reauths; we plan for exactly one. */
  reauthCount: number;
}

export type AuthState =
  | { state: "HONOR"; canCaptureSafely: true; honorEndsMs: number }
  | { state: "REAUTH_REQUIRED"; canCaptureSafely: false; reason: string }
  | { state: "EXPIRED"; canCaptureSafely: false; reason: string };

export function authState(a: AuthRecord, nowMs: number): AuthState {
  const validUntil = a.originalAuthorizedAtMs + 29 * DAY;
  if (nowMs >= validUntil) {
    return { state: "EXPIRED", canCaptureSafely: false, reason: "29-day validity elapsed — create a new authorization from the vaulted payment token" };
  }
  const honorEndsMs = Math.min(a.lastAuthorizedAtMs + 3 * DAY, validUntil);
  if (nowMs < honorEndsMs) return { state: "HONOR", canCaptureSafely: true, honorEndsMs };
  return { state: "REAUTH_REQUIRED", canCaptureSafely: false, reason: "Honor period expired — reauthorize, then capture against the NEW authorization id" };
}

/** What the watchdog job should do for a hold right now. */
export function watchdogAction(a: AuthRecord, nowMs: number, settlementDueSoon: boolean):
  "NONE" | "REAUTHORIZE" | "REPLACE_AUTH" {
  const s = authState(a, nowMs);
  if (s.state === "EXPIRED") return "REPLACE_AUTH";
  // Don't burn a reauth speculatively; do it only when capture is imminent.
  if (s.state === "REAUTH_REQUIRED" && settlementDueSoon) return a.reauthCount >= 1 ? "REPLACE_AUTH" : "REAUTHORIZE";
  return "NONE";
}
