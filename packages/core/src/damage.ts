import type { LineItem } from "./settlement";

/**
 * Gate-in vs gate-out damage diff on vision-model detections.
 * Fixes vs Gemini: matching is ONE-TO-ONE (one old dent cannot excuse three new
 * ones), restricted to the same panel + defect type, low-confidence detections
 * are never billed (they go to review), and liability follows custody.
 */
export type Panel = "LEFT" | "RIGHT" | "FRONT" | "REAR_DOORS" | "ROOF" | "UNDERCARRIAGE";
export type DefectType = "DENT" | "PUNCTURE" | "SCRATCH" | "RUST" | "SEAL_BROKEN" | "MISSING_STRAP" | "MISSING_LOAD_BAR";

export interface Detection {
  id: string;
  panel: Panel;
  type: DefectType;
  /** Normalized to the panel plane, 0..1. */
  box: { x: number; y: number; w: number; h: number };
  confidence: number; // 0..1 from the vision model
  severity: number;   // 0..1
  imageRef: string;
}

export function iou(a: Detection["box"], b: Detection["box"]): number {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const inter = ix * iy;
  const union = a.w * a.h + b.w * b.h - inter;
  return union <= 0 ? 0 : inter / union;
}

export interface DamageDiff {
  newDefects: Detection[];
  preExisting: Array<{ gateIn: Detection; gateOut: Detection; iou: number }>;
  needsReview: Detection[];          // low-confidence gate-out detections: never billed automatically
  disappeared: Detection[];          // seen at gate-in, not at gate-out (repaired/occluded) — informational
}

export function diffDamage(gateIn: Detection[], gateOut: Detection[], opts: { iouThreshold?: number; minConfidence?: number } = {}): DamageDiff {
  const thr = opts.iouThreshold ?? 0.3;
  const minConf = opts.minConfidence ?? 0.6;
  const reliableOut = gateOut.filter((d) => d.confidence >= minConf);
  const needsReview = gateOut.filter((d) => d.confidence < minConf);
  // Low-confidence gate-in detections still count as prior evidence (benefit of doubt to the carrier).
  const pairs: Array<{ i: number; o: number; s: number }> = [];
  gateIn.forEach((a, i) => reliableOut.forEach((b, o) => {
    if (a.panel !== b.panel || a.type !== b.type) return;
    const s = iou(a.box, b.box);
    if (s >= thr) pairs.push({ i, o, s });
  }));
  pairs.sort((p, q) => q.s - p.s);
  const usedIn = new Set<number>(), usedOut = new Set<number>();
  const preExisting: DamageDiff["preExisting"] = [];
  for (const p of pairs) {
    if (usedIn.has(p.i) || usedOut.has(p.o)) continue;
    usedIn.add(p.i); usedOut.add(p.o);
    preExisting.push({ gateIn: gateIn[p.i]!, gateOut: reliableOut[p.o]!, iou: p.s });
  }
  // A pre-existing defect that got materially WORSE is new damage for the delta.
  const worsened = preExisting.filter((m) => m.gateOut.severity - m.gateIn.severity >= 0.3).map((m) => m.gateOut);
  return {
    newDefects: [...reliableOut.filter((_, o) => !usedOut.has(o)), ...worsened],
    preExisting: preExisting.filter((m) => !worsened.includes(m.gateOut)),
    needsReview,
    disappeared: gateIn.filter((_, i) => !usedIn.has(i)),
  };
}

export type DamageTariff = Record<DefectType, { minorCents: number; majorCents: number }>;

export const DEFAULT_TARIFF: DamageTariff = {
  DENT: { minorCents: 4500, majorCents: 18000 },
  PUNCTURE: { minorCents: 12000, majorCents: 45000 },
  SCRATCH: { minorCents: 0, majorCents: 3500 },
  RUST: { minorCents: 0, majorCents: 0 },            // wear, never billed as damage
  SEAL_BROKEN: { minorCents: 12000, majorCents: 12000 },
  MISSING_STRAP: { minorCents: 3800, majorCents: 3800 },
  MISSING_LOAD_BAR: { minorCents: 6500, majorCents: 6500 },
};

/**
 * Who pays depends on who had custody between the two scans:
 *  - FACILITY custody (truck in their yard/dock): facility/shipper pays, passed through to carrier.
 *  - CARRIER custody (container out on interchange): carrier pays, netted from its payout.
 */
export function damageLineItems(diff: DamageDiff, custodyBetweenScans: "FACILITY" | "CARRIER", tariff: DamageTariff = DEFAULT_TARIFF): LineItem[] {
  return diff.newDefects
    .map((d) => {
      const t = tariff[d.type];
      const cents = d.severity >= 0.5 ? t.majorCents : t.minorCents;
      return {
        kind: d.type === "SEAL_BROKEN" ? "SEAL" : d.type.startsWith("MISSING") ? "HARDWARE" : "DAMAGE",
        payer: custodyBetweenScans === "FACILITY" ? "SHIPPER" : "CARRIER",
        cents,
        description: `New ${d.type.toLowerCase()} on ${d.panel} (sev ${d.severity.toFixed(2)}, conf ${d.confidence.toFixed(2)})`,
        evidenceRef: d.imageRef,
      } satisfies LineItem;
    })
    .filter((li) => li.cents > 0);
}
