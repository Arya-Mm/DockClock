import { handle } from "@/lib/server/http";
import { verifyChain } from "@/lib/server/chain";

/** Recompute the agent_action hash chain from genesis. Read-only. */
export const GET = handle(async () => Response.json({ data: await verifyChain() }));
