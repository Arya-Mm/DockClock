import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { opsAuthorized, OPS_COOKIE } from "./http";

/** Server-component guard for ops pages (/cockpit, /dashboard): live money data never renders without the ops session. */
export async function requireOpsPage(path: string) {
  const [c, h] = await Promise.all([cookies(), headers()]);
  if (!opsAuthorized(h.get("x-ops-key"), c.get(OPS_COOKIE)?.value)) redirect(`/ops?next=${encodeURIComponent(path)}`);
}
