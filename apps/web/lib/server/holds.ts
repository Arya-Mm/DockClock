import "server-only";
import { prisma } from "@dockclock/db";
import { paypalRequestId, authState, type LoadState } from "@dockclock/core";
import { createHoldOrder, createHoldOrderVaulted, authorizeOrder, authorizationFrom, vaultIdFrom, voidHold, reauthorize, type Order, type Authorization } from "@dockclock/paypal";
import { recorded } from "./ops";
import { getLoad, sizeHold, moveState } from "./loads";
import { DomainError } from "./http";

const describe = (id: string) => `DockClock dock-time hold, load ${id}`;

/** The demo has one shipper; its vault id comes from the first approved hold (M18 fallback: none means approval each time). */
export async function shipperVaultId(): Promise<string | null> {
  const l = await prisma.load.findFirst({ where: { vaultId: { not: null } }, orderBy: { updatedAt: "desc" } });
  return l?.vaultId ?? null;
}

/** Dispatch: size the hold (engine), then either authorize from the vault (no redirect) or create an order for approval. */
export async function startHold(loadId: string, opts: { useVault?: boolean } = {}) {
  const load = await getLoad(loadId);
  if (load.state !== "DISPATCHED") throw new DomainError("state_conflict", `load ${loadId} already has a hold (${load.state})`);
  const rec = await sizeHold(load);
  const vaultId = opts.useVault === false ? null : await shipperVaultId();

  if (vaultId) {
    const r = await recorded<Order>({ loadId, operation: "ORDER_VAULTED", requestId: paypalRequestId(loadId, "ORDER", "vaulted"), amountCents: rec.holdCents },
      async () => {
        const { order, authorize } = await createHoldOrderVaulted(loadId, rec.holdCents, describe(loadId), vaultId);
        return authorize ?? order;
      });
    const auth = authorizationFrom(r.data);
    if (!auth) throw new DomainError("no_authorization", "vaulted order returned no authorization");
    const now = new Date();
    await moveState(loadId, "DISPATCHED", "AUTHORIZED", { holdCents: rec.holdCents, orderId: r.data.id, authorizationId: auth.id, vaultId, authorizedAt: now, lastAuthorizedAt: now });
    return { mode: "VAULTED" as const, hold: rec, orderId: r.data.id, authorizationId: auth.id, debugId: r.debugId, replayed: r.replayed };
  }

  const r = await recorded<Order>({ loadId, operation: "ORDER", requestId: paypalRequestId(loadId, "ORDER", "vault"), amountCents: rec.holdCents },
    () => createHoldOrder(loadId, rec.holdCents, describe(loadId), true));
  await moveState(loadId, "DISPATCHED", "AWAITING_PAYER", { holdCents: rec.holdCents, orderId: r.data.id });
  return { mode: "APPROVAL" as const, hold: rec, orderId: r.data.id, debugId: r.debugId, replayed: r.replayed };
}

/** After payer approval in JS SDK v6. Stores the vault id for later server-side holds. */
export async function authorizeHold(loadId: string, orderId: string) {
  const load = await getLoad(loadId);
  if (load.orderId !== orderId) throw new DomainError("order_mismatch", "order does not belong to this load");
  const r = await recorded<Order>({ loadId, operation: "AUTHORIZE", requestId: paypalRequestId(loadId, "AUTHORIZE", orderId) }, () => authorizeOrder(loadId, orderId));
  const auth = authorizationFrom(r.data);
  if (!auth) throw new DomainError("no_authorization", "authorize returned no authorization");
  const vaultId = vaultIdFrom(r.data);
  if (load.state === "AWAITING_PAYER") {
    const now = new Date();
    await moveState(loadId, "AWAITING_PAYER", "AUTHORIZED", { authorizationId: auth.id, vaultId, authorizedAt: now, lastAuthorizedAt: now });
  }
  return { authorizationId: auth.id, status: auth.status, vaultId, vaultStatus: r.data.payment_source?.paypal?.attributes?.vault?.status ?? null, debugId: r.debugId, replayed: r.replayed };
}

/** Core machine allows VOIDED only from these states. */
const VOIDABLE: LoadState[] = ["AUTHORIZED", "NEEDS_REVIEW", "SETTLING"];

export async function voidLoadHold(loadId: string) {
  const load = await getLoad(loadId);
  if (!load.authorizationId) throw new DomainError("no_hold", "load has no authorization");
  const from = load.state as LoadState;
  if (from !== "VOIDED" && !VOIDABLE.includes(from)) throw new DomainError("state_conflict", `cannot void from ${from}`);
  const authId = load.authorizationId;
  const r = await recorded({ loadId, operation: "VOID", requestId: paypalRequestId(loadId, "VOID", authId), paypalIdOf: () => authId }, () => voidHold(loadId, authId));
  if (from !== "VOIDED") await moveState(loadId, from, "VOIDED");
  return { authorizationId: authId, debugId: r.debugId, replayed: r.replayed };
}

/** Reauthorize only when authLifecycle says REAUTH_REQUIRED and none was used (M1, M3). */
export async function reauthorizeHold(loadId: string, nowMs = Date.now()) {
  const load = await getLoad(loadId);
  if (!load.authorizationId || !load.authorizedAt || !load.lastAuthorizedAt || !load.holdCents) throw new DomainError("no_hold", "load has no authorization");
  const s = authState({ authorizationId: load.authorizationId, originalAuthorizedAtMs: load.authorizedAt.getTime(), lastAuthorizedAtMs: load.lastAuthorizedAt.getTime(), reauthCount: load.reauthCount }, nowMs);
  if (s.state === "HONOR") throw new DomainError("reauth_not_allowed", `inside honor period until ${new Date(s.honorEndsMs).toISOString()} (M1)`);
  if (s.state === "EXPIRED") throw new DomainError("reauth_not_allowed", s.reason);
  if (load.reauthCount >= 1) throw new DomainError("reauth_not_allowed", "already reauthorized once; replace from vault (M3)");
  const authId = load.authorizationId, cents = load.holdCents;
  const r = await recorded<Authorization>({ loadId, operation: "REAUTHORIZE", requestId: paypalRequestId(loadId, "REAUTHORIZE", authId), amountCents: cents }, () => reauthorize(loadId, authId, cents));
  // Replay: the stored op already updated the load; incrementing again would weaken the one-reauth gate (M3).
  if (!r.replayed) await prisma.load.updateMany({ where: { id: loadId, authorizationId: authId }, data: { authorizationId: r.data.id, lastAuthorizedAt: new Date(nowMs), reauthCount: { increment: 1 } } });
  return { previousAuthorizationId: authId, authorizationId: r.data.id, debugId: r.debugId, replayed: r.replayed };
}
