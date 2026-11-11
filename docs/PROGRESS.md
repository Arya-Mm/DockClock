# PROGRESS

## Phase 0: Recon & foundation (DONE)
Monorepo, Prisma schema + append-only triggers, doctor, flags, CI, licence. DB on Neon (Docker unavailable locally).

## Phase 1: Money backbone (DONE)
- Sandbox proof (Nov 11): order 0L8360031H268620E (f2142183d6031), authorize + vault 0nr23177ny854364p (ca58b811acb0d),
  settle capture 8XN82214LL1617838 $81.25 on $75 hold (ca58b84169978).
- Integration (RUN_SANDBOX=1): void ca58b82641e02, partial capture ca58b827ebec4, overcapture $57.50 on $50 ca58b829e9d9b,
  double-submit same capture ca58b82bc9904/ca58b82bd0fb7/ca58b82d29d3e.
- Next: Phase 2 webhooks, worker, payouts, invoices, disputes.

## Phase 2: Webhooks, worker, payouts, invoices, disputes (PARTIAL: dispute live test pending)
- Webhook 4LX331612L6716300 on a Cloudflare quick tunnel (URL changes per run; Render gets a permanent one in Phase 6).
- Webhook-only E2E (Nov 11): load LD-MWBUZNJG vaulted hold 0FE89053GE731611K (ca58bef7b8ccc), capture 5EH33012VJ8618906
  (ca58beff149f7), CAPTURE.COMPLETED webhook -> payout 73.12 batch 4FJB5BKZED94U (ca58bf09a7dd9), PAYOUTS-ITEM.SUCCEEDED -> PAID_OUT.
- Poll fallback E2E: LD-MWBS0IQL payout BS4MCZG4GY9YL (f864221f9369e), status SUCCESS (f91909688dc65).
- Replay: simulator delivered WH-7Y7254563A4550640-11V2185806837105M twice -> 1 row. Forged -> 401, not stored.
- Pending: sandbox buyer opens a dispute to verify provide-evidence field names live; run pnpm seed:reauth on Nov 12.
