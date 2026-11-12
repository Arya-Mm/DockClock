import { notFound } from "next/navigation";
import { fmtUsd } from "@dockclock/core/i18n";
import { verifyReceipt } from "@/lib/server/driver";
import "../../driver/driver.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Proof-of-Wait receipt" };

interface Body {
  loadId: string; facility: string; carrier: string; contractVersionId: string; appointment: string;
  evidence: { source: string; kind: string; utc: string; confidence: number; citation: string }[];
  planVersion: number; planHash: string;
  plan: { action: string; dwellMin: number; billableMin: number; chargeCents: number; captureCents: number; releasedCents: number; driverPayoutCents: number; audit: string[] };
  paypal: { operation: string; paypalId: string | null; debugId: string | null; amountCents: number | null }[];
}

/** Public Proof-of-Wait receipt. Anyone with the link can re-check the hash; amounts are engine output. */
export default async function ReceiptPage(props: PageProps<"/r/[slug]">) {
  const { slug } = await props.params;
  const v = await verifyReceipt(slug);
  if (!v) notFound();
  const b = v.receipt.body as unknown as Body;
  const rows: [string, string][] = [
    ["Dwell", `${b.plan.dwellMin} min`], ["Billable", `${b.plan.billableMin} min`], ["Charged", fmtUsd(b.plan.chargeCents)],
    ["Captured from hold", fmtUsd(b.plan.captureCents)], ["Released to shipper", fmtUsd(b.plan.releasedCents)], ["Paid to driver", fmtUsd(b.plan.driverPayoutCents)],
  ];
  return (
    <div className="rd">
      <main className="rd-wrap">
        <section className="rd-sign"><div className="rd-sign-inner">
          <span className="rd-place">Proof of wait at {b.facility}</span>
          <span className="rd-clock-num" style={{ fontSize: "clamp(3.5rem, 20vw, 5.5rem)" }}>{fmtUsd(b.plan.driverPayoutCents)}</span>
          <span className="rd-sign-line">Load {b.loadId}, {b.carrier}</span>
        </div></section>

        <p className={`rd-banner ${v.ok ? "rd-banner-warn" : "rd-banner-stop"}`} role="status">
          {v.ok ? "Verified: this receipt matches its audit hash." : "Does not verify: the receipt was changed after it was issued."}
        </p>

        <section className="rd-offer" style={{ borderLeftColor: "var(--rd-green)" }}>
          <h2>Settlement</h2>
          <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "6px 16px", margin: 0 }}>
            {rows.map(([k, val]) => <div key={k} style={{ display: "contents" }}><dt className="rd-muted">{k}</dt><dd className="rd-money" style={{ margin: 0, textAlign: "right" }}>{val}</dd></div>)}
          </dl>
        </section>

        <section className="rd-offer" style={{ borderLeftColor: "var(--rd-fog)" }}>
          <h2>Evidence</h2>
          <ol style={{ margin: 0, paddingLeft: 20, display: "grid", gap: 6 }}>
            {b.evidence.map((e, i) => <li key={i}>{e.kind.toLowerCase()} {e.utc.slice(11, 16)} UTC, {e.source.replaceAll("_", " ").toLowerCase()} <span className="rd-muted">({e.citation})</span></li>)}
          </ol>
        </section>

        <section className="rd-offer" style={{ borderLeftColor: "var(--rd-fog)" }}>
          <h2>PayPal record</h2>
          <ul style={{ margin: 0, paddingLeft: 20, display: "grid", gap: 6, wordBreak: "break-all" }}>
            {b.paypal.map((p, i) => <li key={i}>{p.operation.toLowerCase()} {p.paypalId ?? ""} {p.amountCents !== null ? fmtUsd(p.amountCents) : ""} <span className="rd-muted">debug_id {p.debugId ?? "n/a"}</span></li>)}
          </ul>
        </section>

        <section className="rd-muted" style={{ wordBreak: "break-all", fontSize: 14 }}>
          <p>Contract {b.contractVersionId}, plan version {b.planVersion} ({b.planHash.slice(0, 16)}…)</p>
          <p>Audit hash {v.receipt.auditHash}</p>
          <p>Recomputed {v.recomputed}</p>
        </section>
      </main>
    </div>
  );
}
