import { prisma } from "@dockclock/db";
import { runReconcile } from "../lib/server/reconcile";

runReconcile(Number(process.argv[2] ?? 3)).then((r) => console.log(JSON.stringify(r))).finally(() => prisma.$disconnect());
