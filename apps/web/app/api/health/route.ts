import { health } from "@/lib/server/health";

export const dynamic = "force-dynamic";

/** Render health check (render.yaml healthCheckPath). 503 when the database is unreachable. */
export async function GET() {
  try { return Response.json(await health(), { headers: { "cache-control": "no-store" } }); }
  catch { return Response.json({ ok: false, error: "database unreachable" }, { status: 503 }); }
}
