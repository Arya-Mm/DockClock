# PROGRESS

## Phase 0: Recon & foundation (DONE)
Monorepo, Prisma schema + append-only triggers, doctor, flags, CI, licence. DB on Neon (Docker unavailable locally).

## Phase 1: Money backbone (DONE)
- Sandbox proof (Nov 11): order 0L8360031H268620E (f2142183d6031), authorize + vault 0nr23177ny854364p (ca58b811acb0d),
  settle capture 8XN82214LL1617838 $81.25 on $75 hold (ca58b84169978).
- Integration (RUN_SANDBOX=1): void ca58b82641e02, partial capture ca58b827ebec4, overcapture $57.50 on $50 ca58b829e9d9b,
  double-submit same capture ca58b82bc9904/ca58b82bd0fb7/ca58b82d29d3e.
- Next: Phase 2 webhooks, worker, payouts, invoices, disputes.
