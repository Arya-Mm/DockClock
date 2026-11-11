import { MIN } from "./time.js";

/**
 * Evidence reconciliation. This is where the AI earns its keep and where most
 * hackathon builds are naive: they trust ONE timestamp (usually the LLM's read
 * of the BOL). Real disputes happen because sources disagree.
 *
 * Rule: hardware-grade sources (ELD geofence, yard gate system) set the clock.
 * AI-extracted document times corroborate or raise a discrepancy flag; they
 * can only set the clock alone when no hardware source exists, and then the
 * settlement is routed to human review.
 */
export type EvidenceSource = "ELD_GEOFENCE" | "YARD_GATE_SYSTEM" | "DRIVER_APP_CHECKIN" | "BOL_AI_EXTRACTED";
export type EventKind = "ARRIVAL" | "DEPARTURE";

export interface EvidenceEvent {
  source: EvidenceSource;
  kind: EventKind;
  utcMs: number;
  /** Extraction confidence 0..1 (1 for hardware). */
  confidence: number;
  /** Verbatim snippet / sensor id so the audit trail can cite it. */
  citation: string;
}

const TRUST: Record<EvidenceSource, number> = {
  ELD_GEOFENCE: 3,
  YARD_GATE_SYSTEM: 3,
  DRIVER_APP_CHECKIN: 2,
  BOL_AI_EXTRACTED: 1,
};

export type EvidenceFlag =
  | "NO_ARRIVAL_EVIDENCE"
  | "NO_DEPARTURE_EVIDENCE"
  | "HARDWARE_SOURCES_DISAGREE"
  | "DOCUMENT_CONTRADICTS_HARDWARE"
  | "DOCUMENT_ONLY_EVIDENCE"
  | "LOW_EXTRACTION_CONFIDENCE"
  | "DEPARTURE_BEFORE_ARRIVAL";

export interface ResolvedTimeline {
  arrivalMs: number | null;
  departureMs: number | null;
  flags: EvidenceFlag[];
  /** true => money must not move without a human approving. */
  requiresReview: boolean;
  basis: string[];
}

export interface ReconcileOptions {
  /** Max disagreement between two hardware sources before we stop trusting either. */
  hardwareToleranceMin?: number;
  /** Max disagreement between document and hardware before we flag a discrepancy. */
  documentToleranceMin?: number;
  minAiConfidence?: number;
}

function resolveKind(events: EvidenceEvent[], kind: EventKind, o: Required<ReconcileOptions>, flags: Set<EvidenceFlag>, basis: string[]): number | null {
  const ofKind = events.filter((e) => e.kind === kind);
  if (ofKind.length === 0) return null;

  const topTrust = Math.max(...ofKind.map((e) => TRUST[e.source]));
  const top = ofKind.filter((e) => TRUST[e.source] === topTrust);

  if (topTrust === TRUST.BOL_AI_EXTRACTED) {
    flags.add("DOCUMENT_ONLY_EVIDENCE");
    if (top.some((e) => e.confidence < o.minAiConfidence)) flags.add("LOW_EXTRACTION_CONFIDENCE");
  }

  const times = top.map((e) => e.utcMs);
  const spread = Math.max(...times) - Math.min(...times);
  if (topTrust === 3 && spread > o.hardwareToleranceMin * MIN) flags.add("HARDWARE_SOURCES_DISAGREE");

  // Conservative choice for the PAYER: latest arrival, earliest departure among
  // the top-trust sources. Billing the shorter dwell is what survives a dispute.
  const chosen = kind === "ARRIVAL" ? Math.max(...times) : Math.min(...times);
  basis.push(`${kind}: ${new Date(chosen).toISOString()} from ${top.map((e) => e.source).join("+")}`);

  for (const doc of ofKind.filter((e) => TRUST[e.source] < topTrust)) {
    if (Math.abs(doc.utcMs - chosen) > o.documentToleranceMin * MIN) {
      flags.add("DOCUMENT_CONTRADICTS_HARDWARE");
      basis.push(`${kind}: ${doc.source} says ${new Date(doc.utcMs).toISOString()} ("${doc.citation}") — ${Math.round(Math.abs(doc.utcMs - chosen) / MIN)}m off, overruled`);
    }
  }
  return chosen;
}

export function reconcileTimeline(events: EvidenceEvent[], opts: ReconcileOptions = {}): ResolvedTimeline {
  const o: Required<ReconcileOptions> = {
    hardwareToleranceMin: opts.hardwareToleranceMin ?? 10,
    documentToleranceMin: opts.documentToleranceMin ?? 15,
    minAiConfidence: opts.minAiConfidence ?? 0.85,
  };
  const flags = new Set<EvidenceFlag>();
  const basis: string[] = [];
  const arrivalMs = resolveKind(events, "ARRIVAL", o, flags, basis);
  const departureMs = resolveKind(events, "DEPARTURE", o, flags, basis);
  if (arrivalMs === null) flags.add("NO_ARRIVAL_EVIDENCE");
  if (departureMs === null) flags.add("NO_DEPARTURE_EVIDENCE");
  if (arrivalMs !== null && departureMs !== null && departureMs < arrivalMs) flags.add("DEPARTURE_BEFORE_ARRIVAL");

  // A document contradicting hardware is informational (hardware wins) — it does
  // not block settlement. Everything else that weakens the clock does.
  const blocking: EvidenceFlag[] = [
    "NO_ARRIVAL_EVIDENCE", "NO_DEPARTURE_EVIDENCE", "HARDWARE_SOURCES_DISAGREE",
    "DOCUMENT_ONLY_EVIDENCE", "LOW_EXTRACTION_CONFIDENCE", "DEPARTURE_BEFORE_ARRIVAL",
  ];
  const f = [...flags];
  return { arrivalMs, departureMs, flags: f, requiresReview: f.some((x) => blocking.includes(x)), basis };
}
