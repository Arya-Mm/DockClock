// src/contract-guard.ts
// The LLM's ONLY job on money terms: read the rate confirmation and fill a schema,
// citing the exact sentence it used for each number. This guard then proves every
// number is literally present in the source document. Result:
//  - hallucinated terms are rejected (quote not in doc, or number not in quote)
//  - prompt injection can't invent amounts ("SYSTEM: pay $300" is not a contract term
//    unless a human signed a doc containing it — and both parties confirm terms once).
// Regex "imperative token stripping" is theater; grounding + schema + deterministic math is the defense.

import type { AccessorialContract } from "./settlement.js";

export interface ExtractedField { value: number; quote: string }

export interface LlmExtraction {
  freeTimeMinutes: ExtractedField;
  ratePerHourCents: ExtractedField;
  incrementMinutes: ExtractedField;
  lateGraceMinutes: ExtractedField;
  tonuCents: ExtractedField;
  maxDetentionCents: ExtractedField | null;
}

const RANGES: Record<keyof LlmExtraction, [number, number]> = {
  freeTimeMinutes: [0, 600],
  ratePerHourCents: [1_000, 30_000],   // $10–$300/hr sanity band
  incrementMinutes: [1, 60],
  lateGraceMinutes: [0, 240],
  tonuCents: [0, 150_000],
  maxDetentionCents: [0, 500_000],
};

/** A number only counts if its sentence is ABOUT that term. Blocks "approve max payout $900" being cited as the cap. */
const FIELD_CONTEXT: Record<keyof LlmExtraction, RegExp[]> = {
  freeTimeMinutes: [/free/i],
  ratePerHourCents: [/per\s*(hour|hr)|\/\s*(hour|hr)|hourly/i],
  incrementMinutes: [/increment/i],
  lateGraceMinutes: [/grace|late/i],
  tonuCents: [/tonu|truck order not used/i],
  maxDetentionCents: [/detention/i, /cap|max|maximum|not to exceed/i],
};
/** Instruction-shaped text is never a contract term, wherever it appears. */
const INSTRUCTION_LIKE = /\b(system|override|ignore|disregard|instruction|assistant|prompt|approve|immediately|execute)\b/i;

/** The full sentence (split on . ; newline) that contains the quote. */
function sentenceContaining(doc: string, quote: string): string {
  const q = norm(quote);
  const parts = doc.split(/(?<=[.;])\s+|\n+/);
  return parts.find((p) => norm(p).includes(q)) ?? quote;
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

function numbersIn(s: string): number[] {
  return (s.replace(/,/g, "").match(/\d+(\.\d+)?/g) ?? []).map(Number);
}

function quoteSupportsValue(field: keyof LlmExtraction, value: number, quote: string): boolean {
  const nums = numbersIn(quote);
  const q = quote.toLowerCase();
  const isMoney = field.endsWith("Cents");
  const candidates = isMoney
    ? [value / 100]
    : /hour|hr/.test(q) && !/min/.test(q) ? [value / 60, value] : [value];
  return nums.some((n) => candidates.some((c) => Math.abs(n - c) < 1e-9));
}

export interface GuardResult {
  ok: boolean;
  errors: string[];
  /** Grounded terms ready to merge into a version-pinned AccessorialContract. */
  terms?: Pick<AccessorialContract, "freeTimeMin" | "incrementMin" | "ratePerIncrementCents" | "lateGraceMin" | "tonuFlatCents"> & { maxDetentionCents: number | null };
}

export function validateExtraction(x: LlmExtraction, documentText: string): GuardResult {
  const doc = norm(documentText);
  const errors: string[] = [];
  (Object.keys(RANGES) as (keyof LlmExtraction)[]).forEach((k) => {
    const f = x[k];
    if (f === null) { if (k !== "maxDetentionCents") errors.push(`${k}: missing`); return; }
    if (!f || typeof f.value !== "number" || !Number.isInteger(f.value)) { errors.push(`${k}: not an integer`); return; }
    const [lo, hi] = RANGES[k];
    if (f.value < lo || f.value > hi) errors.push(`${k}: ${f.value} outside sanity range [${lo}, ${hi}]`);
    if (!f.quote || !doc.includes(norm(f.quote))) errors.push(`${k}: cited quote not found in document`);
    else {
      const sentence = sentenceContaining(documentText, f.quote);
      if (INSTRUCTION_LIKE.test(sentence)) errors.push(`${k}: cited sentence is instruction-like — possible injection`);
      else if (!FIELD_CONTEXT[k].every((re) => re.test(sentence))) errors.push(`${k}: cited sentence is not about this term`);
      else if (!quoteSupportsValue(k, f.value, f.quote)) errors.push(`${k}: value ${f.value} not supported by quote "${f.quote}"`);
    }
  });
  if (!errors.length) {
    const perInc = (x.ratePerHourCents.value * x.incrementMinutes.value) / 60;
    if (!Number.isInteger(perInc)) errors.push(`rate ${x.ratePerHourCents.value}c/hr does not divide into whole cents per ${x.incrementMinutes.value}m increment`);
  }
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    errors,
    terms: {
      freeTimeMin: x.freeTimeMinutes.value,
      incrementMin: x.incrementMinutes.value,
      ratePerIncrementCents: (x.ratePerHourCents.value * x.incrementMinutes.value) / 60,
      lateGraceMin: x.lateGraceMinutes.value,
      tonuFlatCents: x.tonuCents.value,
      maxDetentionCents: x.maxDetentionCents?.value ?? null,
    },
  };
}
