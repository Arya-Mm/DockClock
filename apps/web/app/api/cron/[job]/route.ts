import { handle, requireOps, fail } from "@/lib/server/http";
import { tick, reconcileNow } from "@/lib/server/jobs";

// Free stand-in for Render Cron (paid): .github/workflows/cron.yml calls these with the ops key.
//   tick       every 10 min: wakes a sleeping free instance and runs one worker pass
//   reconcile  nightly: DockClock captures vs PayPal Transaction Search
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export const POST = handle(async (req: Request, ctx: RouteContext<"/api/cron/[job]">) => {
  const denied = requireOps(req);
  if (denied) return denied;
  const { job } = await ctx.params;
  if (job === "tick") return Response.json({ data: { ran: await tick() } });
  if (job === "reconcile") return Response.json({ data: await reconcileNow() });
  return fail(404, "unknown_job", `no cron job "${job}"`);
});
