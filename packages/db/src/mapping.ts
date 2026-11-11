import { createHash } from "node:crypto";
import type { SettlementAction } from "@dockclock/core";

/** Seeded (historical) loads: final state implied by the engine's settlement action. */
export function stateForAction(a: SettlementAction): "VOIDED" | "CAPTURED" | "INVOICED" | "REVIEW" {
  switch (a) {
    case "VOID": return "VOIDED";
    case "CAPTURE": return "CAPTURED";
    case "CAPTURE_AND_INVOICE": return "INVOICED";
    case "HOLD_FOR_REVIEW": return "REVIEW";
  }
}

/** sha256 over JSON with sorted keys, so hashes don't depend on key order. */
export function sha256Json(v: unknown): string {
  const canon = (x: unknown): unknown =>
    Array.isArray(x) ? x.map(canon)
    : x && typeof x === "object" ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, canon((x as Record<string, unknown>)[k])]))
    : x;
  return createHash("sha256").update(JSON.stringify(canon(v))).digest("hex");
}
