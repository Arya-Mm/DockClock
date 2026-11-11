import "server-only";
import { prisma, type Prisma } from "@dockclock/db";
import { PayPalError, type PayPalResult } from "@dockclock/paypal";

export interface OpMeta { loadId?: string; operation: string; requestId: string; amountCents?: number; paypalIdOf?: (data: unknown) => string | undefined }

export interface Recorded<T> { data: T; debugId: string | null; requestId: string; replayed: boolean }

/**
 * Every PayPal write goes through here (CLAUDE.md): the paypal_op row is written BEFORE the HTTP call.
 * A second call with the same request id returns the stored result without calling PayPal (M8 double-submit);
 * a PENDING row (lost response) is retried with the same PayPal-Request-Id, which PayPal dedupes.
 */
export async function recorded<T>(meta: OpMeta, fn: () => Promise<PayPalResult<T>>): Promise<Recorded<T>> {
  const prior = await prisma.payPalOp.findUnique({ where: { requestId: meta.requestId } });
  if (prior?.status === "SUCCEEDED") {
    return { data: prior.response as T, debugId: prior.debugId, requestId: meta.requestId, replayed: true };
  }
  if (!prior) {
    // Webhook and worker poll can race on the same step: the loser of the insert just proceeds; PayPal dedupes
    // the HTTP call by the shared PayPal-Request-Id, so both get the same result.
    await prisma.payPalOp.create({ data: { requestId: meta.requestId, operation: meta.operation, loadId: meta.loadId, amountCents: meta.amountCents } })
      .catch((e: unknown) => { if ((e as { code?: string }).code !== "P2002") throw e; });
  }
  try {
    const r = await fn();
    await prisma.payPalOp.update({
      where: { requestId: meta.requestId },
      data: { status: "SUCCEEDED", debugId: r.debugId, httpStatus: r.status, paypalId: meta.paypalIdOf?.(r.data) ?? idOf(r.data), response: r.data as Prisma.InputJsonValue },
    });
    return { data: r.data, debugId: r.debugId, requestId: meta.requestId, replayed: false };
  } catch (e) {
    if (e instanceof PayPalError) {
      await prisma.payPalOp.update({
        where: { requestId: meta.requestId },
        data: { status: "FAILED", debugId: e.debugId, httpStatus: e.status, response: (e.body ?? {}) as Prisma.InputJsonValue },
      });
    }
    throw e;
  }
}

const idOf = (d: unknown) => (d && typeof d === "object" && "id" in d && typeof d.id === "string" ? d.id : undefined);
