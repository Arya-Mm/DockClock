import { z } from "zod";
import { prisma } from "@dockclock/db";
import { DEMO_CONTRACT } from "@dockclock/core";
import { handle, parseBody, requireOps } from "@/lib/server/http";

const Body = z.object({
  facilityId: z.string().min(1),
  carrierId: z.string().min(1).optional(),
  appointmentAt: z.iso.datetime().optional(),
});

/** Dispatch a new (non-synthetic) load. */
export const POST = handle(async (req: Request) => {
  const denied = requireOps(req);
  if (denied) return denied;
  const b = await parseBody(req, Body);
  if (b instanceof Response) return b;
  const carrier = b.carrierId ? { id: b.carrierId } : await prisma.carrierProfile.findFirstOrThrow({ orderBy: { id: "asc" } });
  const id = `LD-${Date.now().toString(36).toUpperCase()}`;
  const load = await prisma.load.create({ data: {
    id, facilityId: b.facilityId, carrierId: carrier.id, contractVersionId: DEMO_CONTRACT.contractVersionId,
    appointmentAt: b.appointmentAt ? new Date(b.appointmentAt) : new Date(), synthetic: false,
  } });
  return Response.json({ data: load }, { status: 201, headers: { Location: `/api/loads/${id}` } });
});

export const GET = handle(async () => {
  const loads = await prisma.load.findMany({ where: { synthetic: false }, orderBy: { createdAt: "desc" }, take: 50 });
  return Response.json({ data: loads });
});
