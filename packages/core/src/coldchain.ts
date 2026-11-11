import { MIN } from "./time";
import type { LineItem } from "./settlement";

/**
 * Reefer temperature compliance.
 * Fixes vs Gemini: Mean Kinetic Temperature is TIME-WEIGHTED (loggers sample
 * irregularly; a burst of readings during a door-open must not dominate),
 * sensor gaps are detected (a gap is not "in range"), and excursions are
 * attributed to whoever had CUSTODY during that segment.
 */
export interface Reading { tMs: number; c: number }
export interface CustodySegment { fromMs: number; toMs: number; party: "SHIPPER" | "CARRIER"; label: string }

const DH_OVER_R = 83.144 / 0.008314; // ΔH/R in Kelvin (ICH default ΔH = 83.144 kJ/mol)

/** Each reading weighted by half of its neighbouring intervals (trapezoid support). */
export function timeWeightedMkt(readings: Reading[]): number | null {
  const r = [...readings].sort((a, b) => a.tMs - b.tMs);
  if (r.length === 0) return null;
  if (r.length === 1) return r[0]!.c;
  let num = 0, den = 0;
  for (let i = 0; i < r.length; i++) {
    const prev = i > 0 ? r[i]!.tMs - r[i - 1]!.tMs : 0;
    const next = i < r.length - 1 ? r[i + 1]!.tMs - r[i]!.tMs : 0;
    const w = (prev + next) / 2;
    num += w * Math.exp(-DH_OVER_R / (r[i]!.c + 273.15));
    den += w;
  }
  if (den === 0) return r[0]!.c;
  return Number((DH_OVER_R / -Math.log(num / den) - 273.15).toFixed(2));
}

export interface ColdChainPolicy {
  maxMktC: number;            // e.g. 8.0
  maxSingleExcursionMin: number; // continuous minutes above maxInstantC allowed (door-open tolerance)
  maxInstantC: number;        // e.g. 10.0
  maxSensorGapMin: number;    // e.g. 20
  penaltyCents: number;
}

export interface SegmentVerdict {
  label: string;
  party: CustodySegment["party"];
  mktC: number | null;
  longestExcursionMin: number;
  sensorGapMin: number;
  breach: boolean;
  reasons: string[];
}

export function evaluateColdChain(readings: Reading[], custody: CustodySegment[], p: ColdChainPolicy): { segments: SegmentVerdict[]; requiresReview: boolean; lineItems: LineItem[] } {
  const segments: SegmentVerdict[] = custody.map((seg) => {
    const r = readings.filter((x) => x.tMs >= seg.fromMs && x.tMs <= seg.toMs).sort((a, b) => a.tMs - b.tMs);
    const reasons: string[] = [];
    // Gaps, including leading/trailing gaps against the segment boundaries.
    const edges = [seg.fromMs, ...r.map((x) => x.tMs), seg.toMs];
    let gap = 0;
    for (let i = 1; i < edges.length; i++) gap = Math.max(gap, edges[i]! - edges[i - 1]!);
    const sensorGapMin = Math.round(gap / MIN);
    if (sensorGapMin > p.maxSensorGapMin) reasons.push(`sensor gap ${sensorGapMin}m > ${p.maxSensorGapMin}m`);

    let longest = 0, runStart: number | null = null;
    for (const x of r) {
      if (x.c > p.maxInstantC) { runStart ??= x.tMs; longest = Math.max(longest, x.tMs - runStart); }
      else runStart = null;
    }
    const longestExcursionMin = Math.round(longest / MIN);
    const mktC = timeWeightedMkt(r);
    if (mktC !== null && mktC > p.maxMktC) reasons.push(`MKT ${mktC}°C > ${p.maxMktC}°C`);
    if (longestExcursionMin > p.maxSingleExcursionMin) reasons.push(`continuous ${longestExcursionMin}m above ${p.maxInstantC}°C`);
    const breach = reasons.some((x) => !x.startsWith("sensor gap"));
    return { label: seg.label, party: seg.party, mktC, longestExcursionMin, sensorGapMin, breach, reasons };
  });
  const requiresReview = segments.some((s) => s.sensorGapMin > p.maxSensorGapMin);
  const lineItems: LineItem[] = requiresReview ? [] : segments.filter((s) => s.breach).map((s) => ({
    kind: "COLD_CHAIN", payer: s.party, cents: p.penaltyCents,
    description: `Temperature breach during ${s.label}: ${s.reasons.join("; ")}`,
    evidenceRef: `logger:${s.label}`,
  }));
  return { segments, requiresReview, lineItems };
}
