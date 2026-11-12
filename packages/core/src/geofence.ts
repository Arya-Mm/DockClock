import type { EvidenceEvent } from "./evidence";

/**
 * Derives ARRIVAL/DEPARTURE evidence from the raw ELD GPS ping stream instead
 * of trusting a pre-labelled "arrived" event, and detects spoofing:
 *  - teleport: implied speed between consecutive pings above a physical limit
 *  - stale stream: ping gaps long enough that entry/exit time is unknowable
 * Arrival = first ping inside the fence that starts a dwell; departure = last
 * inside ping before the truck is seen outside again.
 */
export interface Ping { tMs: number; lat: number; lng: number; source: string }
export interface Facility { id: string; lat: number; lng: number; radiusM: number }

export function haversineM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6_371_000, rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad, dLng = (bLng - aLng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export interface GeofenceResult {
  events: EvidenceEvent[];
  spoofSuspected: boolean;
  issues: string[];
}

export function deriveGeofenceEvents(pings: Ping[], f: Facility, opts: { maxSpeedKmh?: number; maxGapMin?: number; reentryMergeMin?: number } = {}): GeofenceResult {
  const maxSpeed = opts.maxSpeedKmh ?? 130;
  const maxGap = (opts.maxGapMin ?? 15) * 60_000;
  const p = [...pings].sort((a, b) => a.tMs - b.tMs);
  const issues: string[] = [];
  let spoof = false;

  for (let i = 1; i < p.length; i++) {
    const dt = (p[i]!.tMs - p[i - 1]!.tMs) / 3_600_000;
    if (dt <= 0) { issues.push(`duplicate/out-of-order ping at ${new Date(p[i]!.tMs).toISOString()}`); continue; }
    const kmh = haversineM(p[i - 1]!.lat, p[i - 1]!.lng, p[i]!.lat, p[i]!.lng) / 1000 / dt;
    if (kmh > maxSpeed) { spoof = true; issues.push(`teleport ${Math.round(kmh)} km/h at ${new Date(p[i]!.tMs).toISOString()}`); }
  }

  const inside = p.map((x) => haversineM(x.lat, x.lng, f.lat, f.lng) <= f.radiusM);
  const firstIn = inside.indexOf(true);
  const events: EvidenceEvent[] = [];
  if (firstIn === -1) {
    issues.push("truck never inside facility geofence");
    return { events, spoofSuspected: spoof, issues };
  }
  // T14: a trip outside the fence of <= reentryMergeMin (fuel, scale) is the same visit; longer is a new visit,
  // which this stop does not bill (it is reported so a human can decide).
  const mergeMs = (opts.reentryMergeMin ?? 30) * 60_000;
  let lastIn = firstIn;
  for (let i = firstIn + 1; i < p.length; i++) {
    if (!inside[i]) continue;
    const outsideMs = p[i]!.tMs - p[lastIn]!.tMs;
    if (i > lastIn + 1 && outsideMs > mergeMs) {
      issues.push(`re-entry after ${Math.round(outsideMs / 60000)}m outside at ${new Date(p[i]!.tMs).toISOString()}: new visit, not billed on this stop (T14)`);
      break;
    }
    if (i > lastIn + 1) issues.push(`left fence for ${Math.round(outsideMs / 60000)}m and returned: same visit (T14)`);
    lastIn = i;
  }

  const gapBefore = firstIn > 0 ? p[firstIn]!.tMs - p[firstIn - 1]!.tMs : 0;
  const gapAfter = lastIn + 1 < p.length ? p[lastIn + 1]!.tMs - p[lastIn]!.tMs : 0;
  if (gapBefore > maxGap) issues.push(`ping gap ${Math.round(gapBefore / 60000)}m before entry — arrival time uncertain`);
  if (gapAfter > maxGap) issues.push(`ping gap ${Math.round(gapAfter / 60000)}m before exit — departure time uncertain`);
  const lastSeenInside = lastIn === p.length - 1;

  // Spoofed or uncertain streams are still reported, but at confidence 0 so reconciliation can't let them set the clock alone.
  const conf = spoof ? 0 : 1;
  events.push({ source: "ELD_GEOFENCE", kind: "ARRIVAL", utcMs: p[firstIn]!.tMs, confidence: conf, citation: `${p[firstIn]!.source}@${p[firstIn]!.lat.toFixed(5)},${p[firstIn]!.lng.toFixed(5)}` });
  if (!lastSeenInside) {
    events.push({ source: "ELD_GEOFENCE", kind: "DEPARTURE", utcMs: p[lastIn]!.tMs, confidence: conf, citation: `${p[lastIn]!.source}@${p[lastIn]!.lat.toFixed(5)},${p[lastIn]!.lng.toFixed(5)}` });
  } else issues.push("truck still inside geofence — no departure yet");
  return { events: spoof ? [] : events, spoofSuspected: spoof, issues };
}
