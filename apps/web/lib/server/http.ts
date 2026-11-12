import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { timingSafeEqual } from "node:crypto";
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
    try { return await fn(...a); }
    catch (e) {
      if (e instanceof PayPalError) return fail(502, "paypal_error", e.message, { debugId: e.debugId, issue: e.issue });
      if (e instanceof DomainError) return fail(409, e.code, e.message);
      console.error(e);
      return fail(500, "internal_error", "Internal error");
    }
  };
}

export class DomainError extends Error { constructor(public code: string, msg: string) { super(msg); } }

/**
 * Ops gate for routes that move money or change mandates. With DOCKCLOCK_OPS_KEY set, the x-ops-key header must match.
 * Unset is allowed only outside production (local sandbox dev). shortcut: one shared key, replace with real auth in Phase 7.
 */
export function requireOps(req: Request): Response | null {
  const key = process.env.DOCKCLOCK_OPS_KEY;
  if (!key) return process.env.NODE_ENV === "production" ? fail(401, "unauthorized", "ops key not configured") : null;
  const got = Buffer.from(req.headers.get("x-ops-key") ?? "");
  const want = Buffer.from(key);
  return got.length === want.length && timingSafeEqual(got, want) ? null : fail(401, "unauthorized", "missing or wrong x-ops-key");
}
