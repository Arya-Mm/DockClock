import { requireOps, handle } from "@/lib/server/http";
import { resetDemo } from "@/lib/server/control";

/** Safe demo reset: expires open offers only. No load, PayPal op, webhook, receipt or ledger row is changed. */
export const POST = handle(async (req: Request) => {
  const denied = requireOps(req);
  if (denied) return denied;
  return Response.json({ data: await resetDemo() });
});
