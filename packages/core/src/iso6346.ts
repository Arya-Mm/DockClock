/**
 * ISO 6346 container-number check digit. Only relevant if you show container
 * drayage; trailer-only demos can skip it.
 *
 * Unlike the Gemini version, OCR "healing" never silently picks a code:
 * we enumerate ambiguous-glyph swaps and accept a correction ONLY if exactly
 * one candidate passes the check digit. Otherwise -> human review.
 */
const LETTER_VALUES: Record<string, number> = (() => {
  const m: Record<string, number> = {};
  let v = 10;
  for (const ch of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") {
    if (v % 11 === 0) v++; // skip 11, 22, 33
    m[ch] = v++;
  }
  return m;
})();

export function checkDigit(first10: string): number | null {
  if (!/^[A-Z]{3}[UJZR][0-9]{6}$/.test(first10)) return null;
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const ch = first10[i]!;
    const val = i < 4 ? LETTER_VALUES[ch]! : Number(ch);
    sum += val * 2 ** i;
  }
  return (sum % 11) % 10;
}

export function isValidContainer(code: string): boolean {
  const c = code.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (c.length !== 11) return false;
  const d = checkDigit(c.slice(0, 10));
  return d !== null && d === Number(c[10]);
}

const TO_LETTER: Record<string, string> = { "0": "O", "1": "I", "5": "S", "8": "B", "2": "Z" };
const TO_DIGIT: Record<string, string> = { O: "0", I: "1", S: "5", B: "8", Z: "2", D: "0", Q: "0" };

export type OcrResult =
  | { status: "VALID"; code: string }
  | { status: "CORRECTED"; code: string; from: string }
  | { status: "REVIEW"; candidates: string[] };

export function resolveContainerOcr(raw: string): OcrResult {
  const c = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (isValidContainer(c)) return { status: "VALID", code: c };
  if (c.length !== 11) return { status: "REVIEW", candidates: [] };

  // Build per-position options, then enumerate (bounded: ≤ 2^11).
  const opts: string[][] = [...c].map((ch, i) => {
    const alt = i < 4 ? TO_LETTER[ch] : TO_DIGIT[ch];
    return alt ? [ch, alt] : [ch];
  });
  let acc = [""];
  for (const o of opts) acc = acc.flatMap((p) => o.map((x) => p + x));
  const valid = [...new Set(acc.filter(isValidContainer))];
  if (valid.length === 1) return { status: "CORRECTED", code: valid[0]!, from: c };
  return { status: "REVIEW", candidates: valid };
}
