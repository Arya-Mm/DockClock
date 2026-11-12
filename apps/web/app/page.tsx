import Link from "next/link";
import { Oswald, Barlow_Condensed } from "next/font/google";
import { DEMO_CONTRACT } from "@dockclock/core";
import { WaitSign } from "./wait-sign";
import "./landing.css";

// Type from the MotionSites "logistics-freight" design: condensed grotesques, the voice of freight stencils.
const display = Oswald({ subsets: ["latin"], weight: ["700"], variable: "--lf-display" });
const ui = Barlow_Condensed({ subsets: ["latin"], weight: ["400", "600", "700"], variable: "--lf-ui" });

export const metadata = { title: { absolute: "DockClock: drivers paid for the wait, before the gate" },
  description: "A PayPal authorization hold becomes a spending mandate for AI agents. The AI reads, code decides, PayPal executes." };

const REPO = "https://github.com/Arya-Mm/DockClock";
// Hotlinked, not committed (CLAUDE.md: no third-party media in the repo).
// Hero: MotionSites logistics-freight clip. Gate band: Pixabay "Road, Cargo, Trailer" (Pixabay Content License).
const HERO_VIDEO = "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20261005_115944_095d91d4-030f-4e82-b42b-a388c0816d24.mp4";
const TRUCK_VIDEO = "https://cdn.pixabay.com/video/2022/12/18/143479-782374009_large.mp4";

// The real order of events for one load; numbered because it is a sequence.
const STEPS = [
  { t: "Hold at dispatch", d: "The shipper approves a PayPal authorization once. Its size comes from dwell history at that dock, not a flat guess." },
  { t: "Wait, measured", d: "Geofence, gate system, driver check-in and the BOL photo are reconciled into one timeline. Weak evidence goes to a human." },
  { t: "Paid at the gate", d: "Capture, payout to the driver, an invoice for anything above the hold, and a defence pack if the charge is disputed." },
];

const SURFACES = [
  { href: "/judge", t: "Judge mode", d: "Eight scenarios with the real sandbox calls behind them." },
  { href: "/dock", t: "Dock board", d: "Doors and trucks live. Drag a truck to re-price it." },
  { href: "/cockpit", t: "Ops cockpit", d: "Ledgers, the review queue whose approve cell captures, reconciliation." },
  { href: "/dashboard", t: "Analytics", d: "Ask questions of the ledger in plain language." },
  { href: "/driver", t: "Driver app", d: "Wait clock, offers and pay in English, Spanish, Hindi and Punjabi." },
  { href: "/verify", t: "Verify a receipt", d: "Check a Proof-of-Wait against the hash-chained ledger." },
];

export default function Home() {
  return (
    <main className={`lp ${display.variable} ${ui.variable}`}>
      <section className="lf-hero" aria-labelledby="hero-title">
        <video className="lf-bg" src={HERO_VIDEO} autoPlay muted loop playsInline disablePictureInPicture
          aria-label="Aerial view of a container freight train crossing black coal terrain" />
        <div className="lf-tint" />
        <header className="lp-bar">
          <span className="lp-mark">DockClock</span>
          <nav aria-label="Main"><Link href="/judge">Judge mode</Link><a href={REPO}>Source</a></nav>
        </header>
        <div className="lf-stage">
          <h1 id="hero-title" className="lf-headline">
            <span>Paid for</span><span>the wait</span><span>before the</span><span>gate.</span>
          </h1>
          <svg className="lf-mark" viewBox="0 0 52 52" fill="none" aria-hidden="true">
            <circle cx="26" cy="26" r="23" stroke="#D6523A" strokeWidth="1.6" strokeDasharray="98.3 46.3" transform="rotate(2.5 26 26)" />
            <g stroke="#D6523A" strokeWidth="1.6" strokeLinecap="round">
              <circle cx="26.5" cy="26.1" r="2.3" /><path d="M26.5 23.8V12.5M28.5 27.2L35 31" />
            </g>
          </svg>
          <section className="lf-feature lf-left">
            <h2>One hold,<br />set at dispatch</h2>
            <p>The shipper approves a PayPal authorization once. It caps what any AI agent can spend on this load.</p>
          </section>
          <section className="lf-feature lf-right">
            <h2>Code decides<br />every dollar</h2>
            <p>The AI reads the evidence. The engine prices in integer cents. PayPal moves the money.</p>
          </section>
          <div className="lf-cta">
            <Link className="lp-btn" href="/judge">Open judge mode</Link>
            <Link className="lp-btn lp-btn-ghost" href="/dock">See the dock board</Link>
          </div>
        </div>
      </section>

      <section className="lp-facts" aria-labelledby="why">
        <h2 id="why">Why the wait goes unpaid</h2>
        <dl>
          <div><dt>39.3%</dt><dd>of stops detain the driver (ATRI 2024)</dd></div>
          <div><dt>Under half</dt><dd>of detention invoices get paid, though 94.5% of fleets bill it (ATRI 2024)</dd></div>
          <div><dt>$1.1–1.3B</dt><dd>a year in lost driver income (DOT OIG 2018)</dd></div>
        </dl>
      </section>

      <section className="lp-steps" aria-labelledby="how">
        <h2 id="how">One load, start to finish</h2>
        <ol>{STEPS.map((s) => <li key={s.t}><h3>{s.t}</h3><p>{s.d}</p></li>)}</ol>
      </section>

      <section className="lf-gate" aria-labelledby="clock">
        <video className="lf-bg" src={TRUCK_VIDEO} autoPlay muted loop playsInline disablePictureInPicture
          aria-label="A cargo truck with a trailer driving down a road" />
        <div className="lf-gate-shade" />
        <div className="lf-gate-inner">
          <div>
            <h2 id="clock">The clock runs at the dock. The money waits on PayPal.</h2>
            <p>Free time ends, detention starts, and the hold already covers it. When the truck rolls out, the driver is paid.</p>
          </div>
          <WaitSign contract={DEMO_CONTRACT} />
        </div>
      </section>

      <section className="lp-rule" aria-labelledby="rule">
        <h2 id="rule">Agents can negotiate. They can never set a price.</h2>
        <div className="lp-flow">
          <div><b>The AI reads</b><span>Agents pick from typed offer menus. Vision returns typed detections. Text from another agent is display only.</span></div>
          <div><b>Code decides</b><span>The engine prices in integer cents. A mandate guard checks caps, counterparties and the hold ceiling, and logs every verdict in a hash chain.</span></div>
          <div><b>PayPal executes</b><span>Orders, captures, payouts, invoices and dispute evidence, each with an idempotent request id and a recorded debug_id.</span></div>
        </div>
      </section>

      <section className="lp-surfaces" aria-labelledby="try">
        <h2 id="try">Try it in the sandbox</h2>
        <ul>{SURFACES.map((s) => <li key={s.href}><Link href={s.href}><b>{s.t}</b><span>{s.d}</span></Link></li>)}</ul>
        <p className="lp-small">Ops pages ask for the ops key once. Everything runs against the PayPal sandbox only.</p>
      </section>

      <footer className="lp-foot">
        <p>Built with PayPal Orders, Payments, Payouts, Invoicing, Disputes, Webhooks and Transaction Search, the PayPal Server SDK, AG Grid, AG Studio, Bryntum Scheduler, Channel3, Render and Gemini.</p>
        <p><a href={REPO}>Source on GitHub</a> · MIT licence. Hero footage via MotionSites; truck footage via Pixabay.</p>
      </footer>
    </main>
  );
}
