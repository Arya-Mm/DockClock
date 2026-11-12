import { z } from "zod";
import { handle, parseBody, requireOps } from "@/lib/server/http";
import { previewMove } from "@/lib/server/dock";

// Read-only re-price for a dragged bar. The client sends only a time; the engine prices it. Nothing is saved.
const Body = z.object({ loadId: z.string().min(1).max(100), endMs: z.number().int().positive() }).strict();

export const POST = handle(async (req: Request) => {
  const denied = requireOps(req);
  if (denied) return denied;
  const b = await parseBody(req, Body);
  if (b instanceof Response) return b;
  return Response.json({ data: await previewMove(b.loadId, b.endMs) });
});
