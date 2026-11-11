import { z } from "zod";
import { prisma } from "@dockclock/db";
import { handle, parseBody, DomainError } from "@/lib/server/http";
import { getLoad, moveState } from "@/lib/server/loads";

const Body = z.object({
  source: z.enum(["ELD_GEOFENCE", "YARD_GATE_SYSTEM", "DRIVER_APP_CHECKIN", "BOL_AI_EXTRACTED"]),
  kind: z.enum(["ARRIVAL", "DEPARTURE"]),
  utcAt: z.iso.datetime(),
  deviceAt: z.iso.datetime().optional(),
  confidence: z.number().min(0).max(1).default(1),
  citation: z.string().min(1).max(500),
});

/** Append evidence (append-only table). Arrival/departure advances the load state. */
export const POST = handle(async (req: Request, ctx: RouteContext<"/api/loads/[id]/evidence">) => {
  const { id } = await ctx.params;
  const b = await parseBody(req, Body);
  if (b instanceof Response) return b;
  const load = await getLoad(id);
  if (b.kind === "DEPARTURE" && load.state === "AUTHORIZED") throw new DomainError("no_arrival", "departure before any arrival evidence");
  const ev = await prisma.evidenceEvent.create({ data: {
    loadId: id, source: b.source, kind: b.kind, utcAt: new Date(b.utcAt), deviceAt: b.deviceAt ? new Date(b.deviceAt) : undefined, confidence: b.confidence, citation: b.citation,
  } });
  if (b.kind === "ARRIVAL" && load.state === "AUTHORIZED") await moveState(id, "AUTHORIZED", "AT_FACILITY");
  else if (b.kind === "DEPARTURE" && load.state === "AT_FACILITY") await moveState(id, "AT_FACILITY", "DEPARTED");
  return Response.json({ data: ev }, { status: 201 });
});
