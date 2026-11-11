import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { PayPalError } from "@dockclock/paypal";

/** Error envelope: { error: { code, message, details?, debugId? } } (api-design skill). */
export function fail(status: number, code: string, message: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ error: { code, message, ...extra } }, { status });
}

export async function parseBody<S extends z.ZodType>(req: Request, schema: S): Promise<z.infer<S> | NextResponse> {
  const raw: unknown = await req.json().catch(() => ({}));
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
