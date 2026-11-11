import type { SettlementPlan } from "./settlement.js";
import type { ResolvedTimeline } from "./evidence.js";

/**
 * Turns the settlement audit trail into a PayPal dispute evidence submission.
 * Numbers come from the plan, never from an LLM. An LLM may rewrite `summary`
 * for tone, but the guard below rejects any rewrite that changes or adds an amount.
 */
export interface EvidencePack {
  evidenceType: "PROOF_OF_FULFILLMENT" | "OTHER";
  notes: string;          // PayPal limits notes length; keep under 2000 chars
  documents: Array<{ name: string; ref: string }>;
}

const usd = (c: number) => `$${(c / 100).toFixed(2)}`;

export function buildEvidencePack(plan: SettlementPlan, timeline: ResolvedTimeline, contractDocRef: string, extraDocs: Array<{ name: string; ref: string }> = []): EvidencePack {
  const lines = [
    `Load ${plan.loadId} — accessorial charge per signed rate confirmation ${plan.contractVersionId}.`,
    `Charged ${usd(plan.captureCents)} (detention ${plan.billableMin} billable minutes after ${plan.dwellMin}m dwell; ${plan.excludedCarrierMin}m carrier-caused time excluded).`,
    `Time basis: ${timeline.basis.join(" | ")}.`,
    plan.lineItems.length ? `Line items: ${plan.lineItems.map((l) => `${l.kind} ${usd(l.cents)} (${l.payer}) ${l.evidenceRef}`).join("; ")}.` : "",
    `Uncaptured hold of ${usd(plan.releasedCents)} was released to the payer at settlement.`,
  ].filter(Boolean);
  let notes = lines.join("\n");
  if (notes.length > 1900) notes = notes.slice(0, 1897) + "...";
  return {
    evidenceType: "PROOF_OF_FULFILLMENT",
    notes,
    documents: [{ name: "rate-confirmation.pdf", ref: contractDocRef }, ...extraDocs],
  };
}

/** Every dollar amount in an AI-rewritten summary must already exist in the source notes. */
export function amountsPreserved(sourceNotes: string, rewritten: string): boolean {
  const amounts = (t: string) => new Set(t.match(/\$\d[\d,]*(\.\d{2})?/g) ?? []);
  const src = amounts(sourceNotes);
  return [...amounts(rewritten)].every((a) => src.has(a));
}
