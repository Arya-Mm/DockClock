import { DateTime } from "luxon";

/**
 * Handwritten BOL / dock-log times are LOCAL wall-clock with no offset.
 * Converting them naively (new Date("2026-11-01T01:30")) silently uses the
 * server's zone and breaks around DST. This resolves against the facility's
 * IANA zone and refuses to guess when the wall-clock time is ambiguous
 * (fall-back hour occurs twice) or nonexistent (spring-forward gap).
 */
export type LocalTimeResult =
  | { ok: true; utcMs: number }
  | { ok: false; reason: "INVALID" | "NONEXISTENT_DST_GAP" | "AMBIGUOUS_DST_OVERLAP" };

export function localWallClockToUtc(localIso: string, ianaZone: string): LocalTimeResult {
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(localIso)) {
    const dt = DateTime.fromISO(localIso, { setZone: true });
    return dt.isValid ? { ok: true, utcMs: dt.toMillis() } : { ok: false, reason: "INVALID" };
  }
  const dt = DateTime.fromISO(localIso, { zone: ianaZone });
  if (!dt.isValid) return { ok: false, reason: "INVALID" };

  // Nonexistent: luxon shifts the time forward; round-trip won't match the input wall clock.
  const wall = DateTime.fromISO(localIso, { zone: "UTC" });
  if (dt.hour !== wall.hour || dt.minute !== wall.minute) {
    return { ok: false, reason: "NONEXISTENT_DST_GAP" };
  }
  // Ambiguous: the same wall clock maps to two instants one hour apart.
  const offsets = dt.getPossibleOffsets();
  if (offsets.length > 1) return { ok: false, reason: "AMBIGUOUS_DST_OVERLAP" };

  return { ok: true, utcMs: dt.toMillis() };
}

export const MIN = 60_000;
export const DAY = 86_400_000;
