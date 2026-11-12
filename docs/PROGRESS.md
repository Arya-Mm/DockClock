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

### Phase 2 live dispute + review (2026-11-12)
- Live sandbox dispute PP-R-BMA-10199009 on capture 5EH33012VJ8618906 (LD-MWBUZNJG), get debug_id f8089366afb6a.
- First evidence upload: 422 ACTION_NOT_ALLOWED_IN_CURRENT_DISPUTE_STATE (f291893f7c905). Retry with same request id: DONE (f269350cc4a29); PROOF_OF_FULFILLMENT + dockclock-audit.txt visible on the dispute (f746279058c58). Multipart field names verified live.
- No CUSTOMER.DISPUTE.* webhook delivered by sandbox; evidence flow started via applyOutcome. Worker now retries failed evidence every 10 min.
- Review fixes: unprocessed duplicate webhooks re-dispatch; carrier invoice before payout wait; captureId+CAPTURED in one write and SETTLING accepted for capture outcomes; FAILED never overwrites SUCCEEDED op; reauth replay no double increment; carrier invoice gated on verified payee; missing invoice email -> MANUAL_REVIEW; non-JSON 5xx retried; worker tick lock + per-load isolation.

## Phase 3: agent layer (2026-11-12)
- Live negotiation on NEG-1112032301: SLOT_SWAP_WITH_CREDIT $22.50 accepted, payout AMV3WA95KPDQY (debug_id f425088159bf7). Hold order 5NP85012EE9672726 (f983538d2c547).
- Guarantee path on NEG-1112033005: WAIT_GUARANTEED $48.75 accepted, captured at departure 2BN62517PX183330N (f873423c685d5), $26.25 released.
- Guard live block on NEG-1112032839: $146.25 guarantee over the $86.25 hold ceiling was BLOCKED, so metered detention was captured instead (8M731300SG085045Y, f253288ed306f).
- Red-team suite 8/8 green (RUN_SANDBOX=1 pnpm --filter @dockclock/web test:redteam): stale, tampered planHash, double accept, over-mandate, over-ceiling, revoked at accept and at departure, "$900" BOL, chain intact.
- Gemini returned 503s and timeouts during the runs, so every agent decision used the deterministic default (A6). The LLM path is unit-tested with a stub; it has not been proven live yet.
- Review (Grill Me substitute) fixes:
  - Ops-key gate (DOCKCLOCK_OPS_KEY, x-ops-key) on negotiate, accept, settle, capture POST and revoke.
  - accept no longer takes `by` from the body.
  - Treasury runs on every shipper-funded accept and is fed no agent text.
  - Daily cap is no longer double-counted at execution.
  - Mandate row lock: revocation and daily cap are re-checked inside the accept transaction.
  - captureOfferOrder re-guards and requires ACCEPTED.
  - Unique (loadId, version).
  - Carrier decisions are logged as DECIDE_*.
  - Overcapture flag honoured at settlement.
  - Transaction timeouts raised for cross-region lock waits.
- Red-team 9/9, including a binding daily cap.
- Open: hash-chain head is not anchored outside the DB (planned with Proof-of-Wait receipts).
- Carrier-paid priority purchase live on NEG-1112042732:
  - Offer OF-d09ff880, PRIORITY_SLOT_PURCHASE $25.00 (engine band floor).
  - Order 8F8165353J782793X (f861048a50597); the carrier approved in the sandbox.
  - Capture 84C11676952052529 COMPLETED (ca592e1ba8832); offer SETTLED.
  - Ledger PROPOSE, ACCEPT, EXECUTE, PAY all ALLOWED; chain intact at 89 rows.
- Webhook note: the quick tunnel failed (Cloudflare API timeout). A mis-registered webhook was deleted (f107914c0868c). Webhook 4LX331612L6716300 still points at the old tunnel URL.
- Tunnel restored: stolen-niagara-ata-wells.trycloudflare.com. Webhook 4LX331612L6716300 repointed by PATCH (ca5930958eaf9), keeping its id. Simulated PAYMENT.CAPTURE.COMPLETED (ca59309fb2ce1) delivered: POST /api/webhooks/paypal 200, signature verified, deduped (simulator reuses its event id).
- scripts/register-webhook.ts now repoints PAYPAL_WEBHOOK_ID instead of creating a new webhook, and refuses the api.trycloudflare.com host.
- `pnpm tunnel` (scripts/tunnel.ts) supervises cloudflared and repoints webhook 4LX331612L6716300 on every new URL. Proven by killing cloudflared: it restarted in 2 s, came up at a new URL and repointed (f616490873acb, then f35948466a1b3).

## Phase 4: driver app, vision, geofence (2026-11-12)
- /driver/<id>?k=<hmac> PWA, checked on a 375x812 viewport:
  - Check-in, live SSE wait clock and detention, offer card with confirmation sheet (typed "yes" only opened the card).
  - Guard block shown on the phone ($130 guarantee over the $86.25 ceiling).
  - Hindi rendering with identical $ strings; payout "sent" then paid.
- Paid at the gate on DRV-1112060304:
  - Simulator spoof rejected (287788 km/h teleport); normal exit settled.
  - Capture 9YE2199251220382U $48.75 (ca593650cbf10), $26.25 released.
  - Payout via the capture webhook through the tunnel; load PAID_OUT.
  - Receipt /r/trFB9YwnfMzP verified (audit hash = recomputed).
- Vision on gemini-3.1-flash-lite (3.8-flash was rate-limited 429 / 503):
  - gate-in: 4 straps, no defects.
  - BOL: 09:15/12:40 to 15:15Z/18:40Z; "$900" note ignored.
  - gate-out: 3 straps, so MISSING_STRAP $38.00 (tariff). The dent's malformed box went to review.
- Channel3 part purchase:
  - 1 missing strap, 3 live options ($19.99, $20.99, ...).
  - Carrier mandate ALLOWED, carrier-paid order 0XK82777CY855345S (ca59378c5daa6) awaiting approval. Capture uses the route proven live in Phase 3.
- Review fixes:
  - Evidence uploads (pings, vision) are ops-only; the driver link is accepted only in dev with FLAG_GEOFENCE_SIM.
  - T10 new-visit-inside never settles.
  - Same-instant spoof detected; ping-gap times at confidence 0.
  - Driver HMAC secret required in production.
  - Voice decline also confirms.
  - Idempotent accept finishes a failed settlement.
  - SSE closed guard; 8 MB body cap.
- Open: receipt hash and agent chain head are not anchored outside the DB.
