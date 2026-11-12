import { z } from "zod";
import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { fail, parseBody, OPS_COOKIE, opsCookieValue } from "@/lib/server/http";

const Body = z.object({ key: z.string().min(1).max(500), next: z.string().max(200).optional() }).strict();

/** Exchange the ops key for an httpOnly session cookie (8 h). The key is never stored client-side. */
export async function POST(req: Request) {
  const b = await parseBody(req, Body);
  if (b instanceof NextResponse) return b;
  const key = process.env.DOCKCLOCK_OPS_KEY;
  if (!key) return fail(503, "not_configured", "DOCKCLOCK_OPS_KEY is not set");
  const got = Buffer.from(b.key), want = Buffer.from(key);
  if (got.length !== want.length || !timingSafeEqual(got, want)) return fail(401, "unauthorized", "wrong ops key");
  const next = b.next && b.next.startsWith("/") && !b.next.startsWith("//") ? b.next : "/cockpit";
  const res = NextResponse.json({ data: { next } });
  res.cookies.set(OPS_COOKIE, opsCookieValue(key), { httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 8 * 3600 });
  return res;
}
