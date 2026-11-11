# dockclock-core (v3)

Deterministic engine behind DockClock: freight accessorials (detention, TONU, damage, seals, cold chain, hardware) settled on PayPal authorization holds.
`npm i && npm test` runs 33 tests. `npm run fixtures` writes the UI data to `fixtures/`.

**The AI reads. Code decides. PayPal executes.** No LLM has a tool that moves money.

## Modules

| Module | Job |
|---|---|
| `contract-guard.ts` | AI-extracted rate-sheet terms: every number cited, the quote must exist in the doc, its sentence must be about that term, instruction-like sentences rejected |
| `geofence.ts` | Arrival/departure derived from raw ELD pings; teleport (spoof) and ping-gap detection |
| `evidence.ts` | Multi-source reconciliation: hardware sets the clock, documents corroborate, document-only → review |
| `time.ts` | Facility-timezone conversion of handwritten times; refuses ambiguous or nonexistent DST times |
| `damage.ts` | One-to-one gate-in/gate-out IoU matching, worsened-defect delta, low confidence → review, custody-based liability |
| `coldchain.ts` | Time-weighted MKT, door-open tolerance, sensor-gap detection, excursion billed to the party in custody |
| `settlement.ts` | Detention rules plus **directional line items**: shipper items captured and passed through; carrier items netted from the payout, with the excess invoiced to the carrier |
| `holdSizer.ts` | Predicted hold size: P90 dwell with hierarchical shrinkage (facility×time bucket → facility → network), sized against PayPal's overcapture ceiling, with a plain-English explanation |
| `tonu.ts` | Survival-based keep-waiting vs release-for-TONU advice plus the break-even line (for Bryntum) |
| `payeeGuard.ts` | Payment-redirect / double-brokering controls: verified payee only, cooling-off after an email change, per-load limit |
| `authLifecycle.ts` | Honor period, reauthorization after it (planned once), 29-day expiry → replace from the vault |
| `executor.ts` | Failure paths: declined capture → invoice, expired auth → re-auth from the vault, pending capture → withhold payout, unclaimed payout, dispute → evidence |
| `disputePack.ts` | Audit trail → PayPal dispute evidence; an AI rewrite may not add or change an amount |
| `ledger.ts` | State machine, stage-scoped idempotency keys, exact money strings |
| `paypal.ts` | REST: vaulted AUTHORIZE, capture, void, reauthorize, Payouts, Invoicing, Disputes evidence, webhook verify |
| `grid.ts` | AG Grid rows, column defs, field descriptions for AG Studio AI, facility quadrant scorecard |
| `seed.ts` | Deterministic synthetic 8-facility network (640 loads) run through the real engine; label it synthetic in the UI |
| `scenarios.ts` | The six judge-mode scenarios, outcomes pinned by tests |

## Sandbox checklist
- App features: **Vault**, **Payouts**, Transaction Search. US business merchant and US personal buyer (no PSD2 limits).
- Webhooks: `PAYMENT.AUTHORIZATION.CREATED`, `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.PENDING`, `PAYMENT.CAPTURE.DENIED`, `PAYMENT.AUTHORIZATION.VOIDED`, `PAYMENT.PAYOUTS-ITEM.SUCCEEDED`, `PAYMENT.PAYOUTS-ITEM.UNCLAIMED`, `PAYMENT.PAYOUTS-ITEM.FAILED`, `VAULT.PAYMENT-TOKEN.CREATED`, `CUSTOMER.DISPUTE.CREATED`, `INVOICING.INVOICE.PAID`.
- Verify the `provide-evidence` multipart field names against the sandbox once before recording.

## Reauthorization demo
Reauthorization is legal only after the 3-day honor period, so it can't happen live before the deadline. In the video, use the simulated clock and label it as such.
Seed one real hold on **Nov 12**: it leaves the honor period on Nov 15 and stays valid until ~Dec 11. A judge clicking **Reauthorize** between Dec 1 and Dec 11 triggers a real PayPal reauthorization. Say this in the submitted README.
