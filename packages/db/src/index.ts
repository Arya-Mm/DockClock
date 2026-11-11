import { PrismaClient } from "@prisma/client";

// One client per process; Next.js dev hot-reload would otherwise open a new pool per reload.
const g = globalThis as unknown as { __dcPrisma?: PrismaClient };
export const prisma = g.__dcPrisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") g.__dcPrisma = prisma;

export * from "@prisma/client";
export { stateForAction, sha256Json } from "./mapping.js";
