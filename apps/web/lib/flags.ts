// Feature flags for every major feature in PLAN §0/§5/§7. Default ON outside production.
// Override per flag with env FLAG_<NAME>=0|1. Scope rule: unfinished features go behind a flag, never get cut.
export const FLAG_NAMES = [
  "HOLD_VAULT",          // §5.1 vaulted repeat holds
  "OVERCAPTURE",         // §5.2 / M4
  "REAUTH",              // §5.4
  "PAYOUTS",             // §5.5 paid at the gate
  "INVOICING",           // §5.6
  "DISPUTES",            // §5.7 auto evidence
  "WEBHOOKS",            // §5.8
  "CARRIER_ORDERS",      // §5.9 carrier-paid orders
  "TXN_RECONCILE",       // Transaction Search reconcile
  "AGENTS",              // §4 negotiation
  "PART_PURCHASE",       // §7.3 Channel3
  "DRIVER_APP",          // §2 driver
  "VOICE",               // Web Speech API
  "VISION",              // gate-cam / BOL
  "GEOFENCE_SIM",
  "COCKPIT",             // §7.1 AG Grid
  "AG_STUDIO",
  "DOCK_BOARD",          // §7.2 Bryntum
  "RED_TEAM",
  "JUDGE_MODE",          // §8
  "RECEIPTS",            // Proof-of-Wait + verify
] as const;

export type FlagName = (typeof FLAG_NAMES)[number];

export function isOn(name: FlagName, env: Record<string, string | undefined> = process.env): boolean {
  const v = env[`FLAG_${name}`];
  if (v === "1" || v === "true") return true;
  if (v === "0" || v === "false") return false;
  return env.NODE_ENV !== "production";
}

export const flags = (env: Record<string, string | undefined> = process.env) =>
  Object.fromEntries(FLAG_NAMES.map((n) => [n, isOn(n, env)])) as Record<FlagName, boolean>;
