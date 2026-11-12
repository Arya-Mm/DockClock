import "server-only";
import { prisma } from "@dockclock/db";
import { notify } from "./executor";

/**
 * F4: daily LLM spend cap (LLM_DAILY_SPEND_CAP_USD). Over the cap every agent falls back to its deterministic
 * default (A6) and vision goes to review, so a public demo can never run up a bill.
 * shortcut: cost is estimated per call (flash-lite class), not metered from the provider; upgrade with usage metadata.
 */
const EST_USD_PER_CALL = 0.0005;
let warnedDay = "";
// Studio dashboard calls (no DB row of their own): counted per UTC day in-process.
// shortcut: per-instance counter; move to a shared store when running more than one instance.
let studioDay = "", studioCalls = 0;
export function noteLlmCall(nowMs = Date.now()) {
  const d = new Date(nowMs).toISOString().slice(0, 10);
  if (d !== studioDay) { studioDay = d; studioCalls = 0; }
  studioCalls++;
}

export async function llmCallsToday(nowMs = Date.now()): Promise<number> {
  const day = new Date(nowMs); day.setUTCHours(0, 0, 0, 0);
  const [agentCalls, visionCalls] = await Promise.all([
    prisma.agentAction.count({ where: { createdAt: { gte: day }, payload: { path: ["source"], equals: "LLM" } } }),
    prisma.visionScan.count({ where: { createdAt: { gte: day }, raw: { not: null } } }),
  ]);
  return agentCalls + visionCalls + (studioDay === new Date(nowMs).toISOString().slice(0, 10) ? studioCalls : 0);
}

export async function llmAllowed(nowMs = Date.now()): Promise<boolean> {
  const capUsd = Number(process.env.LLM_DAILY_SPEND_CAP_USD ?? 5);
  if (!(capUsd > 0)) return false;
  const used = (await llmCallsToday(nowMs)) * EST_USD_PER_CALL;
  if (used < capUsd) return true;
  const day = new Date(nowMs).toISOString().slice(0, 10);
  if (warnedDay !== day) { warnedDay = day; await notify(null, "OPS", "NOTIFY", `LLM daily cap $${capUsd} reached: agents use deterministic defaults, vision goes to review (F4)`); }
  return false;
}
