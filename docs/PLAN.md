# DockClock — Master Plan (stress-tested)
PayPal AI Hackathon · deadline **Fri Nov 13, 01:30 IST** · plan frozen Wed Nov 11, 09:30 IST

> **Pitch line:** *A PayPal authorization hold is a spending mandate for an AI agent.* DockClock gives every party at the loading dock (driver, facility, shipper) an AI agent. The agents negotiate and settle dock time in real time, and can't spend a cent outside a PayPal hold.

---

## 0. What changes from v3 (additions only)

| Layer | v3 (built, 33 tests) | Final |
|---|---|---|
| Engine | Detention, TONU, damage, cold chain, hold sizing, fraud, failure paths | Unchanged core, plus offer pricing, slot pricing, HOS-aware valuation |
| AI | Reads documents, explains | **Three mandate-bound agents** that negotiate and transact (agentic commerce) |
| Money | Hold → capture/void/invoice → payout | Plus **agent-to-agent settlement**: slot swaps, credits, priority purchases, parts purchases |
| Driver | Absent | **Driver phone app**: voice, 4 languages, paid at the gate, Proof-of-Wait receipt |
| Ops | Ledger data files | **AG Grid cockpit**: review queue, agent action ledger, row detail, pivots, Studio + custom widget |
| Trust | Guards in code | **Red-team panel**, mandate kill switch, signed receipts, tamper-evident hash-chained ledger |

---

## 1. Prize map and constraints

**Rule (§8):** one project wins at most **1 Grand or 1 Honorable Mention, plus 1 Sponsor prize**. Ceiling: **$12k (1st) + $5k (AG Grid 1st) = $17k**. Strategy: be top-3 material in every Grand/Honorable category, so whichever the judges assign, we're in it, and lock in AG Grid.

| Prize | What judges must see in the video | Evidence in the product |
|---|---|---|
| 1st/2nd/3rd | Real problem, real PayPal money movement, non-trivial engineering, polished product | Everything; live hosted judge mode |
| Agentic Commerce | Agents transacting *for* people, under enforceable limits, agent-to-agent | Negotiation scene, mandate-block scene, agent ledger |
| Most Impactful | Named victim, verified numbers, money landing in a driver's account | Driver payout scene; ATRI/DOT OIG stats; facility leakage |
| Most Creative | An idea nobody else has: "hold = mandate", a dock-time market | Opening hook, slot exchange |
| Best Demo Delivery | Zero dead air, split screen with live PayPal sandbox, story arc, under 3:00 | Script §9 |
| Best Use of PayPal + AI | Breadth and depth of PayPal APIs with AI deciding *when*, code deciding *how much* | 9 PayPal capabilities (§5) |
| **AG Grid 1st** | Grid doing core work, not decoration; Studio with custom widget + AI | Cockpit spec §7.1 |
| Bryntum / Channel3 / Render / APIMatic | Load-bearing role each | §7.2–7.5 |

**Verified impact numbers (only these go in the video):**
- ATRI 2024: drivers detained at **39.3%** of stops; reefer **56.2%**; **94.5%** of fleets bill detention but **fewer than half of invoices get paid**; about **$15B/yr** industry cost; detained trucks drive **14.6% faster** afterwards.
- DOT OIG 2018: **$1.1–1.3B/yr** lost driver income; **+6.2% expected crash rate per 15 min** of added dwell. It's a fleet-level association; say "associated with", not "causes".
- Drop every Gemini number not in this list.

---

## 2. Product: actors and surfaces

| Actor | Surface | Their agent does | Mandate (enforced by code) |
|---|---|---|---|
| **Driver / owner-operator** | Mobile web app (installable), voice + text, EN/ES/HI/PA | Checks in, accepts or declines offers, gets paid, buys missing straps, shares receipts | Accept offers ≥ its floor; buy parts ≤ $150/load; can **never** change payout destination |
| **Facility (receiver/shipper dock)** | Bryntum dock board | Predicts jams, offers swaps, credits and paid priority | Credits ≤ $X/day; offers only within engine price bands |
| **Shipper / broker treasury** | AG Grid cockpit | Sizes holds, approves exceptions, defends disputes | Spend ≤ hold + overcapture ceiling; above that, a human approves |
| **Platform (DockClock)** | Ops cockpit | Settles, reconciles, enforces | Merchant of record in the demo (roadmap: PayPal Multiparty, §10) |

---

## 3. Architecture

```
Next.js 16 (App Router, TS) ── hosted on Render (web service, paid instance: no cold starts)
 ├─ /driver            mobile web: chat + voice (Web Speech API; falls back to text)
 ├─ /dock              Bryntum Scheduler, live via SSE
 ├─ /cockpit           AG Grid Enterprise + AG Studio
 ├─ /judge             six scenarios + red-team + "reset demo"
 ├─ /api/paypal/*      orders, authorize, capture, void, reauth, payouts, invoices, disputes
 ├─ /api/webhooks/paypal  verify → idempotent event store → state machine
 ├─ /api/agents/*      negotiation rounds (LLM proposes, mandate guard decides)
 └─ /api/vision/*      gate cam + BOL photo → vision LLM → typed detections/events
Render Background Worker: settlement executor queue, reauth watchdog, webhook-poll fallback, nightly reconcile
Render Cron: reconcile vs PayPal Transaction Search; expire offers; auth lifecycle sweep
Postgres (Render): loads, events (append-only, hash-chained), offers, mandates, ledger, webhook_events
dockclock-core (built): pure engine, imported by API + worker
```

**Data model (append-only where money is touched):**
`load`, `contract_version` (fingerprinted, both parties confirm), `evidence_event`, `plan` (versioned, hash), `paypal_op` (request_id unique, status, debug_id), `webhook_event` (event_id unique), `offer` (id, version, ttl, price_cents, from_agent, to_agent, status), `mandate` (agent, caps, scope, expiry, revoked_at), `agent_action` (who, what, mandate_id, verdict, reasons, prev_hash, hash), `carrier_profile` (verified payee), `receipt` (hash of audit, public link).

---

## 4. Agent layer spec (the Agentic Commerce core)

### 4.1 Contract
- **The LLM never emits a number that becomes money.** It picks an *action* from a typed menu; the engine supplies the price.
- Agents talk in **structured offers**. Free text from the other side is *display-only* and never parsed into actions. This blocks agent-to-agent prompt injection.
- Each agent's tool list = its mandate's allowed actions; nothing else is registered.

### 4.2 Offer schema (zod)
```
Offer { id, version, loadId, fromAgent, toAgent,
        kind: WAIT_GUARANTEED | SLOT_SWAP_WITH_CREDIT | RELEASE_TONU | PRIORITY_SLOT_PURCHASE | PART_PURCHASE,
        priceCents (set by engine), slot?: {doorId, startMs}, ttlMs, rationale (LLM text, display only),
        contractVersionId, planHash }
```
Accepting requires `offer.version` + `planHash` to match the current ones: no accepting stale prices.

### 4.3 Pricing (deterministic, engine)
- `WAIT_GUARANTEED`: expected detention from `tonuAdvice` (survival model), capped by contract, guaranteed (no dispute later).
- `SLOT_SWAP_WITH_CREDIT`: credit = value of time saved for the facility, bounded to [10%, 60%] of expected detention avoided.
- `RELEASE_TONU`: contract flat fee.
- `PRIORITY_SLOT_PURCHASE`: carrier pays to jump the queue; price = facility's opportunity cost band; carrier agent buys only if it saves its next load (HOS check).
- `PART_PURCHASE`: Channel3 price + delivery; ≤ the carrier's parts cap.

### 4.4 Carrier Agent valuation (why it accepts)
Inputs: driver's remaining driving hours (simulated ELD clock), next appointment and its deadhead time, per-hour revenue. It accepts the offer with max (payout − value of driving hours lost − risk of missing the next load). That's shown on screen as a 3-row comparison, which makes the agent's reasoning visible.

### 4.5 Mandate guard (code, tested)
Checks, in order: mandate exists and isn't revoked/expired → action in scope → counterparty allowed → amount ≤ per-action cap → daily total ≤ daily cap → amount ≤ PayPal hold capture ceiling (for shipper-funded actions) → payee is the verified profile → offer not expired, version/planHash current. Any failure → `BLOCKED` with reasons → `agent_action` row → escalate to a human if the amount needs it.

### 4.6 Negotiation protocol
Max 3 rounds; each round ≤ 8s LLM timeout. On timeout or invalid output, the **deterministic default offer** goes out (never stalls). Any human can override. Every round is logged with its prompt hash.

---

## 5. PayPal integration (9 capabilities, all real sandbox calls)

| # | Capability | Endpoint | Used for |
|---|---|---|---|
| 1 | Orders v2 AUTHORIZE + vault | `POST /v2/checkout/orders`, `/authorize` | Dock-time hold; payer approves once, then vault id |
| 2 | Capture (partial/final) | `POST /v2/payments/authorizations/{id}/capture` | Settlement; overcapture ≤ min(115%, +$75) |
| 3 | Void | `/void` | Nothing owed |
| 4 | Reauthorize | `/reauthorize` | After honor period (seeded real hold for Dec 1–11) |
| 5 | Payouts v1 | `POST /v1/payments/payouts` | Driver paid at the gate; credits to carriers |
| 6 | Invoicing v2 (+ Agent Toolkit) | create/send/QR/reminders | Spillover; carrier liabilities |
| 7 | Disputes | list/get + `provide-evidence` | Auto-defense |
| 8 | Webhooks + verify | `/v1/notifications/verify-webhook-signature` | Source of truth for state transitions |
| 9 | Orders v2 CAPTURE (carrier as payer) | create + approve + capture | Priority slot / parts purchases paid by the carrier agent |
| + | Transaction Search | `/v1/reporting/transactions` | Nightly reconciliation shown in AG Grid |
| + | Shipment tracking (Agent Toolkit) | `create_shipment_tracking` | Attach load tracking to the PayPal order |

---

## 6. Stress test: edge-case matrix

Status key: ✅ already in core (tested) · 🔨 build in the final plan · 📄 document / disclose

### 6.1 Time and evidence
| # | Edge case | Handling | St |
|---|---|---|---|
| T1 | Early arrival | Clock starts at appointment | ✅ |
| T2 | Late beyond grace | Contract policy: waive or clock from arrival | ✅ |
| T3 | Handwritten local time, DST ambiguous/nonexistent | Refuse to guess → review | ✅ |
| T4 | Facility in Arizona (no DST) / cross-timezone loads | IANA zone per facility (seed includes America/Phoenix) | ✅ |
| T5 | Hardware sources disagree > 10 min | Review | ✅ |
| T6 | BOL contradicts hardware | Hardware wins, discrepancy recorded | ✅ |
| T7 | Only paper evidence | Hold for review; counts as leakage in scorecard | ✅ |
| T8 | GPS teleport / spoof | Stream rejected | ✅ |
| T9 | Ping gaps around entry/exit | Flagged, uncertain time | ✅ |
| T10 | Truck still inside fence | No departure → no settlement | ✅ |
| T11 | Carrier-caused delay, double-logged | Merged intervals excluded | ✅ |
| T12 | Facility closed hours / lunch lockout in contract | Add `facilityPausedIntervals` (contract-defined, non-billable) | 🔨 |
| T13 | Multi-stop load (2 docks) | One settlement per stop; plan keyed `loadId:stopSeq` | 🔨 |
| T14 | Truck re-enters fence (leaves for fuel, returns) | Session split: gap > 30 min outside = new visit; contract says whether it bills | 🔨 |
| T15 | Server clock vs device clock | All decisions on server time; device timestamps are evidence only | 🔨 |

### 6.2 Contract and AI extraction
| # | Edge case | Handling | St |
|---|---|---|---|
| C1 | Hallucinated term | Quote must exist, sentence must match field | ✅ |
| C2 | Injection inside the rate sheet | Instruction-like sentence rejected | ✅ |
| C3 | Rate doesn't divide into increments | Rejected | ✅ |
| C4 | Terms changed after dispatch | Version pinned + fingerprint; both parties confirm; settlement uses the pinned version | 🔨 |
| C5 | Rate sheet scanned / low quality | Vision LLM; any low-confidence field → human confirms that field only | 🔨 |
| C6 | Contract silent on a term (no cap) | Default policy shown and confirmed at dispatch, never inferred | 🔨 |

### 6.3 Money and PayPal
| # | Edge case | Handling | St |
|---|---|---|---|
| M1 | Reauth inside honor period | Blocked by lifecycle | ✅ |
| M2 | Auth expired (day 29+) | Replace from vault | ✅ |
| M3 | Second reauth | Plan once; then replace | ✅ |
| M4 | Charge > hold | Overcapture ≤ ceiling, rest invoiced | ✅ |
| M5 | PSD2 payer | No overcapture | ✅ |
| M6 | Capture declined | Invoice full amount | ✅ |
| M7 | Capture PENDING | Payout withheld until COMPLETED | ✅ |
| M8 | Double click / retry / lost response | Stage-scoped request id + state machine | ✅ |
| M9 | Webhook duplicate / out of order | `event_id` unique; transitions only forward; stale events no-op | 🔨 |
| M10 | Webhook never arrives (sandbox delays) | Worker polls `GET capture` after 60s | 🔨 |
| M11 | Payout UNCLAIMED / FAILED / BLOCKED | Notify / review; funds return after 30d | ✅ |
| M12 | Payer voids hold in their PayPal | `PAYMENT.AUTHORIZATION.VOIDED` → load flagged, invoice path | 🔨 |
| M13 | Rounding remainders | Integer cents; remainder to platform | ✅ |
| M14 | PayPal fees on small captures | Unit economics shows a fee line; platform 10% covers ~3.5% fee | 📄 |
| M15 | Refund after a dispute is lost | `create_refund` via toolkit; ledger reversal row | 🔨 |
| M16 | Partial capture needs a merchant setting | Use single `final_capture: true` capture | ✅ |
| M17 | Currency | USD only; refuse others | ✅ |
| M18 | Vault unavailable in sandbox | Fallback: pre-approve 10 demo holds by JS SDK before recording | 🔨 |
| M19 | Sandbox payout balance empty | Top up sandbox business balance; check balance before demo | 📄 |

### 6.4 Agents
| # | Edge case | Handling | St |
|---|---|---|---|
| A1 | LLM proposes amount | Impossible: schema has no amount field; engine prices | 🔨 |
| A2 | Agent-to-agent injection ("ignore your mandate") | Counterpart text display-only | 🔨 |
| A3 | Stale offer accepted | version + planHash check | 🔨 |
| A4 | Both agents accept simultaneously / double accept | Offer row lock; idempotent accept | 🔨 |
| A5 | Offer spam / griefing | ≤ 3 rounds, rate limit, TTL | 🔨 |
| A6 | LLM timeout / outage | Deterministic default offer; demo uses cached responses if the API is down | 🔨 |
| A7 | Mandate exceeded | BLOCKED + escalate | 🔨 |
| A8 | Mandate revoked mid-negotiation | Checked at accept *and* at execution | 🔨 |
| A9 | Driver says yes by voice, mishears | Confirmation card with amount rendered by code; tap to confirm | 🔨 |
| A10 | Language translation changes the number | Numbers templated by code, never translated by the LLM | 🔨 |
| A11 | Agent buys part already present | Damage diff confirms missing before purchase | 🔨 |
| A12 | Collusion (facility pays carrier inflated credit) | Credit bounded by engine band; daily cap; anomaly flag in ledger | 🔨 |

### 6.5 Fraud and security
| # | Edge case | Handling | St |
|---|---|---|---|
| F1 | Payout redirect / double-brokering | Verified payee, cooling-off | ✅ |
| F2 | Webhook forgery | Signature verify, raw body | ✅ |
| F3 | Secrets in repo | `.env` only; gitleaks in CI; judge mode server-side keys | 🔨 |
| F4 | Judges / public abusing hosted demo | Per-IP rate limit, sandbox only, LLM spend cap, "reset" | 🔨 |
| F5 | Audit tampering | Hash-chained `agent_action` + receipt hash; verifier page | 🔨 |
| F6 | Fake receipt shared | Public verify link recomputes hash | 🔨 |
| F7 | PII (driver phone, location) | Store minimal, coarse location after settlement; documented | 📄 |

### 6.6 Infrastructure and demo
| # | Edge case | Handling | St |
|---|---|---|---|
| D1 | Render free tier cold start (judge waits 50s) | Paid instance through Dec 21 | 🔨 |
| D2 | AG Grid Enterprise / AG Studio license watermark | Get the hackathon license **today** (sponsor resources / Discord) | 🔨 |
| D3 | Bryntum trial watermark | Acceptable; confirm terms in sponsor resources | 📄 |
| D4 | Channel3 credits / API limits | Cache searches for demo SKUs; live call on one | 🔨 |
| D5 | Trial / credit expiry before judging ends | Calendar check: all keys valid to Dec 21 | 📄 |
| D6 | Voice API unsupported (Safari/Firefox) | Text fallback, same flow | 🔨 |
| D7 | Video shows a simulated clock | Labelled "simulated clock" | ✅ |
| D8 | Judge can't run locally | Hosted URL + Postman collection + one-command docker | 🔨 |
| D9 | Post-deadline changes disqualify | Freeze at 01:00; nothing after | 📄 |
| D10 | Synthetic data mistaken for real | "Synthetic network" badge on cockpit | 🔨 |

### 6.7 Legal and credibility (judge questions to pre-empt)
- **"Why PayPal for freight?"** Small fleets dominate trucking. Detention is a small extra charge, slow and disputed on invoice/bank rails; wallets plus instant payouts fit it. Line-haul freight stays on existing rails.
- **"Is the platform a money transmitter?"** Demo = merchant of record in sandbox. Production = **PayPal Multiparty (Commerce Platform)**, with the carrier as the payee of record. Stated on the architecture slide.
- **"What if the facility refuses to join?"** The shipper/broker pays; the facility only needs a gate camera or ELD data. Facilities without either show up as "revenue leak" in the scorecard, which is the sales wedge.

---

## 7. Sponsor specs (load-bearing roles)

### 7.1 AG Grid: the 1st-place spec
**Cockpit grids (AG Grid Enterprise):**
1. **Settlement ledger:** row grouping (facility → carrier), aggregations, set filters, row detail with the full audit trail and PayPal IDs (links), custom action-badge renderers, sparkline of dwell.
2. **Review queue:** editable; approve/reject cell → triggers the executor (real capture) → row updates live via transactions; undo before the webhook lands. *This is the money shot: a grid cell moves real money.*
3. **Agent action ledger:** every agent move, mandate, verdict, blocked reasons; group by agent; red rows for blocked; hash column with "verify".
4. **Reconciliation grid:** DockClock ledger vs PayPal Transaction Search, mismatches highlighted (cell class rules).
5. **Pivot mode:** facility × week, captured vs claimed (leakage).

**AG Studio:**
- Data sources from `fixtures` + live tables, every field described (already in `grid.ts`).
- **Custom widget:** facility quadrant (dwell × recovery, bubble = captured $), with quadrant labels.
- Natural-language queries shown live: "Which facilities leak the most money this month?" and "Show blocked agent actions by reason."
- Themed to the DockClock brand; dashboard saved as state.

**Judges:** Sylwia Vargas (AG Grid) is on the panel. Every AG feature appears in the video for at least 3 seconds with a purpose.

### 7.2 Bryntum Scheduler
Resources = dock doors; events = trucks; colour = settlement state. Break-even line (detention = TONU) drawn per event. Agent-accepted swaps animate the bar move; drag a truck by hand → live re-price preview.

### 7.3 Channel3
The Carrier Agent searches for the missing E-track strap or load bar → three options with price and delivery time → mandate check → the carrier pays via PayPal order → cost line is carrier-payable. Cache demo SKUs; one live call.

### 7.4 Render
Web service + background worker + cron + Postgres + Blueprint (`render.yaml`); worker runs executor/watchdog/poll fallback; health page in judge mode shows queue depth and the last cron run.

### 7.5 APIMatic
PayPal Server SDK (APIMatic-generated) for read paths (Transaction Search, orders get); context plugin used during build (state it plainly in README). REST for money writes (control over idempotency).

---

## 8. Judge mode (hosted, no login)
- `/judge`: six scenarios + **two agentic scenarios** + red-team panel + reset.
  1. Early + old dent → void
  2. Reefer + door spike → capture + payout
  3. Overage → overcapture + invoice + carrier netting
  4. Six-day delay → reauth (sim clock; real on the Dec 1–11 seeded hold)
  5. Spoof + injection → blocked
  6. Dispute → evidence submitted
  7. **Dock jam negotiation** → slot swap + credit settled
  8. **Carrier buys missing strap** (Channel3) under mandate; over-cap attempt blocked
- Every scenario shows: plan, PayPal calls with `debug_id`, webhook arrivals, final ledger rows.
- Rate-limited, sandbox-only, LLM-cached fallbacks.

---

## 9. Demo video: 2:55, beat sheet
| t | Visual | Voiceover idea |
|---|---|---|
| 0:00 | Driver at dock, clock ticking, phone | 39% of stops, under half of detention bills paid |
| 0:12 | Title card | "A PayPal hold is a mandate. Give it to an agent." |
| 0:18 | Shipper dispatches; hold sized $50 vs $275; PayPal sandbox (right half) shows the authorization | Model sizes the hold; payer approved once |
| 0:38 | Dock board: jam predicted; agents negotiate (driver speaks Hindi/Spanish); structured offers on screen | Agents negotiate; code sets the price |
| 1:05 | Swap accepted → Bryntum bar moves → PayPal capture + payout appear right side | Settled in seconds |
| 1:20 | Truck exits geofence → phone: "Paid $73.12" + Proof-of-Wait | Paid before the gate |
| 1:35 | AG Grid cockpit: approve in review queue → capture fires; agent ledger; Studio question → quadrant | The operations view |
| 2:05 | Red team: spoof + "$900" injection + over-mandate purchase → blocked, logged | It can't be tricked into spending |
| 2:25 | Dispute → evidence pack submitted; overage row (overcapture + invoice + netting) | Defends its own deals |
| 2:45 | Architecture card + "hosted, open source, judge mode" | — |
Rules: no loading screens (cut), captions on, AI voiceover OK, royalty-free/no music, no third-party logos except sponsors' own tools shown in use.

---

## 10. Roadmap slide (credibility)
PayPal Multiparty for carrier-as-payee; FMCSA carrier verification; real ELD integrations; facility appointment APIs; factoring-partner payouts; EU version (no overcapture).

---

## 11. Build plan: ~40h, parallel coding agents (one git worktree per track)

| Block (IST) | Track A: money (you) | Track B: agents | Track C: driver + vision | Track D: cockpit | Gate (must be true) |
|---|---|---|---|---|---|
| **Wed 09:30–10:30** | Accounts and keys: PayPal app (Vault, Payouts, Txn Search), webhooks, **AG Grid Enterprise + Studio licence**, Bryntum, Channel3, Render, LLM keys | Write interfaces: Offer, Mandate, AgentAction | — | — | Every key works |
| 10:30–14:00 | Next.js scaffold on boilerplate; core in; hold/vault/authorize/capture/void live | Mandate guard + offer pricing + tests | Driver app shell, chat UI | Ledger grid on data files | **Real sandbox capture** |
| 14:00–20:00 | Webhook store, executor worker, payouts, invoices | Carrier/Facility agents, negotiation protocol, fallbacks | Voice + 4 languages; geofence simulator | Review queue → real capture; row detail | One negotiation settles on PayPal |
| 20:00–02:00 | Disputes evidence; reauth seeding script; reconcile cron | Channel3 purchase under mandate; red-team cases | Gate-cam + BOL vision; Proof-of-Wait + verify page | Agent ledger, reconcile grid, Studio + quadrant widget, Bryntum | All 8 scenarios pass on sandbox |
| **02:00–08:00** | **Sleep** | Agents: tests, lint, type fixes | | | — |
| **Thu 08:00–13:00** | Hash-chained ledger; rate limits; judge mode | Agent polish, cached fallbacks | Mobile polish | Theming, pivot, Studio NL demos | **Feature freeze 13:00** |
| 13:00–17:00 | Render deploy (paid), seed the real reauth hold, README, LICENSE, Postman, docker | Bug bash | Bug bash | Bug bash | Logged-out browser runs all 8 |
| 17:00–21:00 | Record, edit, voiceover, captions → **YouTube public by 21:00** | Devpost text + Built With | Thumbnail, screenshots | — | Video public, under 3:00 |
| 21:00–01:00 | Submit early, verify every link, select all sponsor tools on the form | — | — | — | **Freeze 01:00** (nothing after, incl. README) |

**Behind schedule?** Nothing is removed. Unfinished features stay behind flags. The video shows only what runs; anything replayed from data files is labelled.

---

## 12. Pre-mortem: how we lose, and the countermeasure
1. **Judges can't run it** → hosted paid instance, judge mode, Postman, docker.
2. **Looks like a dashboard, not agents** → negotiation is the centrepiece at 0:38; agent ledger.
3. **"Why PayPal?" unanswered** → line in the video + §6.7.
4. **Sandbox flakes on camera** → record each scene separately; poll fallback; take two.
5. **Licence watermark on AG Grid** → get the licence first thing.
6. **Numbers challenged** → only verified stats, cited in README.
7. **Too fast to follow** → one idea per scene, captions, consistent colour = money state.
8. **Video over 3:00** → hard-cut at 2:55.
9. **Repo missing licence / secrets leak** → MIT in root, gitleaks, About shows the licence.
10. **Post-deadline commit** → branch protection on from 01:00.

---

## 13. Submission checklist
- [ ] Public repo, MIT `LICENSE` at root (visible in About), README: problem, demo URL, judge mode, architecture, PayPal APIs list, AI tools and how they're used, sponsor tools, sandbox accounts, run instructions, verified sources, the reauth window note
- [ ] Hosted URL works logged out; paid through Dec 21; keys valid to Dec 21
- [ ] YouTube public, under 3:00, captions
- [ ] Devpost: description, **Built With** names PayPal + AI explicitly, all sponsor tools ticked
- [ ] Postman collection + docker compose
- [ ] Freeze at 01:00 IST

---

## Appendix A: decisions locked in during the build (previously only in code)

**A1. Money direction (core `settlement.ts`)**
- Detention and TONU are owed by the **shipper**, captured from the shipper's PayPal hold.
- `SHIPPER` line items (facility forklift damage, cold-chain breach while the facility had custody) are captured from the hold and passed **100%** to the carrier.
- `CARRIER` line items (carrier-caused damage, broken seal, missing straps/load bars, cold-chain breach in transit) are **netted from the carrier payout**; any excess is **invoiced to the carrier**.
- Captured funds go to pass-through items first, then detention. Detention is split **90% carrier / 10% platform** (`driverShareBps = 9000`). Integer cents; the rounding remainder stays with the platform.
- If nothing is owed by the shipper: the hold is VOIDED and carrier liabilities are invoiced to the carrier.

**A2. PayPal facts the design depends on (verified against PayPal docs)**
- Authorization valid 29 days; honor period 3 days from the latest (re)authorization.
- Reauthorize only **after** the honor period expires; it returns a new authorization id. Plan for one reauth, then replace from the vault. (Gemini's "reauth at hour 68" is illegal.)
- Payer must approve before `/authorize`. Fix: vault on first approval (`store_in_vault: ON_SUCCESS`), then later holds server-side with `vault_id`.
- Overcapture: total captures ≤ min(115% of auth, auth + $75). Not allowed for PSD2 payers.
- Agent Toolkit has **no** authorize/capture/void/reauth tools. Money writes use REST; the toolkit is for invoices, shipment tracking, disputes and refunds.
- PayPal-Request-Id is scoped to (load, operation, stage), never the amount, so a recomputed amount can't double-capture.
- Webhook signature verification must splice the raw body byte-for-byte.
- PayPal doesn't do domestic INR payments. Pitch and build for USD/US.

**A3. Core module behaviour (dockclock-core v3, 33 tests)**
| Module | Locked behaviour |
|---|---|
| `evidence.ts` | Trust order: ELD geofence = yard gate > driver app > AI-read BOL. Hardware ≥10 min apart → review. Document >15 min off hardware → flagged, hardware wins. Document-only or AI confidence <0.85 → review. Payer-friendly choice: latest arrival, earliest departure |
| `time.ts` | Handwritten times resolved in the facility's IANA zone; ambiguous/nonexistent DST times refused |
| `geofence.ts` | Arrival/departure derived from raw pings; >130 km/h implied speed = spoof (stream discarded); ping gap >15 min flagged |
| `contract-guard.ts` | Each AI-extracted term needs a quote found in the doc, a sentence about that term, no instruction-like wording, a value supported by the quote, a sanity range, and a rate that divides into whole cents per increment |
| `damage.ts` | One-to-one IoU matching (≥0.3, same panel + type); worsened by ≥0.3 severity = new damage; confidence <0.6 = review only; rust never billed; liability by custody between scans |
| `coldchain.ts` | Time-weighted MKT (ΔH 83.144 kJ/mol); door-open tolerance; sensor gap >20 min = review, no penalty; breach billed to the custody party |
| `holdSizer.ts` | P90 dwell with shrinkage facility×time bucket → facility → network (k=20); smallest hold whose overcapture ceiling covers P90 charge; plain-English explanation; e.g. Memphis $50 vs Carson $275 |
| `tonu.ts` | Break-even dwell = free time + ceil(TONU/rate)×increment; advice from loads still waiting at the same point; release only if expected bill >110% of TONU |
| `payeeGuard.ts` | Pay only the verified payee email; 3-day cooling-off after an email change; USDOT format; $750 per-load limit → approval |
| `authLifecycle.ts` | HONOR / REAUTH_REQUIRED / EXPIRED; watchdog reauths only when settlement is imminent |
| `executor.ts` | Declined capture → invoice full amount; expired/voided auth → replace from vault + capture; pending capture → payout withheld; unclaimed payout → notify; dispute → evidence |
| `disputePack.ts` | Evidence notes built from the plan; an AI rewrite may not add or change any $ amount |
| `ledger.ts` | Forward-only load state machine; exact money strings |
| `iso6346.ts` | Check digit; OCR correction accepted only if exactly one candidate validates |
| `seed.ts` / `scenarios.ts` / `grid.ts` | Deterministic 640-load, 8-facility synthetic network (labelled synthetic); paper-only evidence share per facility drives the "revenue leak" quadrant; six scenarios with outcomes pinned by tests; AG Grid rows + field descriptions + quadrant scorecard |

**A4. Demo-honesty rules**
- Reauthorization can't happen live before the deadline: show it on a labelled simulated clock. Seed one real hold on Nov 12; judges can reauthorize it for real between Dec 1 and Dec 11.
- Anything replayed from data files or cached LLM output is labelled "replay"; synthetic data is labelled "synthetic".
- Only the stats in §1 may appear anywhere.

**A5. Source files (the full plan set)**
`docs/PLAN.md` (this file) · `packages/core` (dockclock-core v3) · `CLAUDE.md` + phase prompts (DockClock_ClaudeCode_Prompt.md).
