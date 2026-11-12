import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createHmac, timingSafeEqual } from "node:crypto";
import { PayPalError } from "@dockclock/paypal";

/** Error envelope: { error: { code, message, details?, debugId? } } (api-design skill). */
export function fail(status: number, code: string, message: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ error: { code, message, ...extra } }, { status });
}

const MAX_BODY_BYTES = 8 * 1024 * 1024;

export async function parseBody<S extends z.ZodType>(req: Request, schema: S): Promise<z.infer<S> | NextResponse> {
  // Refuse oversized bodies: the declared length first, then the real one (memory DoS on open routes).
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return fail(413, "too_large", "request body over 8 MB");
  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) return fail(413, "too_large", "request body over 8 MB");
  let raw: unknown = {};
  try { raw = text ? JSON.parse(text) : {}; } catch { raw = {}; }
  const r = schema.safeParse(raw);
  if (r.success) return r.data;
  return fail(422, "validation_error", "Request validation failed", { details: r.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })) });
}

/** Wrap a handler: PayPal errors keep their debug_id; domain errors become 409; nothing else leaks. */
export function handle<A extends unknown[]>(fn: (...a: A) => Promise<Response>) {
  return async (...a: A): Promise<Response> => {
    if (process.env.PAYPAL_ENV === "live") return fail(503, "sandbox_only", "DockClock runs against the PayPal sandbox only (F4)");
    const req = a[0] instanceof Request ? a[0] : null;
    if (req && req.method !== "GET" && !allowWrite(req)) return fail(429, "rate_limited", `Too many requests: limit ${RATE_PER_MIN}/min per IP`, { retryAfterSec: 60 });
    try { return await fn(...a); }
    catch (e) {
      if (e instanceof PayPalError) return fail(502, "paypal_error", e.message, { debugId: e.debugId, issue: e.issue });
      if (e instanceof DomainError) return fail(409, e.code, e.message);
      console.error(e);
      return fail(500, "internal_error", "Internal error");
    }
  };
}

// Per-IP write limit for the public judge deploy (RATE_LIMIT_PER_IP_PER_MIN). Ops-key callers are exempt.
// shortcut: in-memory fixed window per instance; fine on one free instance, move to a shared store when scaling out.
const RATE_PER_MIN = Number(process.env.RATE_LIMIT_PER_IP_PER_MIN ?? 30);
const hits = new Map<string, { windowStart: number; n: number }>();
export function allowWrite(req: Request, nowMs = Date.now()): boolean {
  if (!(RATE_PER_MIN > 0) || opsAuthorized(req.headers.get("x-ops-key"), null)) return true;
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";
  const h = hits.get(ip);
  if (!h || nowMs - h.windowStart >= 60_000) {
    if (hits.size > 10_000) hits.clear(); // bound memory under a spray of spoofed IPs
    hits.set(ip, { windowStart: nowMs, n: 1 });
    return true;
  }
  return ++h.n <= RATE_PER_MIN;
}

export class DomainError extends Error { constructor(public code: string, msg: string) { super(msg); } }

/**
 * Ops gate for routes that move money or change mandates. With DOCKCLOCK_OPS_KEY set, the x-ops-key header must match.
 * Unset is allowed only outside production (local sandbox dev). shortcut: one shared key, replace with real auth in Phase 7.
 */
export function requireOps(req: Request): Response | null {
  return opsAuthorized(req.headers.get("x-ops-key"), cookieValue(req.headers.get("cookie"), OPS_COOKIE)) ? null : fail(401, "unauthorized", "sign in at /ops or send x-ops-key");
}

/** Ops browser session: an httpOnly cookie holding an HMAC of the key, so the key itself never reaches the browser. */
export const OPS_COOKIE = "dc_ops";
export const opsCookieValue = (key: string) => createHmac("sha256", key).update("dockclock-ops-session-v1").digest("base64url");
const same = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };
export function opsAuthorized(headerKey: string | null | undefined, cookie: string | null | undefined): boolean {
  const key = process.env.DOCKCLOCK_OPS_KEY;
  if (!key) return process.env.NODE_ENV !== "production"; // dev without a key stays open; production fails closed
  return (!!headerKey && same(headerKey, key)) || (!!cookie && same(cookie, opsCookieValue(key)));
}
function cookieValue(header: string | null, name: string): string | null {
  for (const part of (header ?? "").split(";")) { const [k, ...v] = part.trim().split("="); if (k === name) return decodeURIComponent(v.join("=")); }
  return null;
}
