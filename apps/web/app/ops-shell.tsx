import Link from "next/link";
import "./ops.css";

// Shared operator chrome (UI/UX skill design system: dark slate, dense, green positive accent, minimal motion).
const NAV: [string, string][] = [["/control", "Control room"], ["/dispatch", "Dispatch"], ["/dock", "Dock board"], ["/cockpit", "Cockpit"], ["/dashboard", "Analytics"], ["/judge", "Judge"], ["/verify", "Verify"], ["/health", "Health"]];

export function OpsShell({ active, title, sub, children, aside }: { active: string; title: string; sub?: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="op">
      <header className="op-top">
        <Link href="/" className="op-brand" title="DockClock home">DockClock</Link>
        <nav aria-label="Operator pages">{NAV.map(([h, l]) => <Link key={h} href={h} aria-current={h === active ? "page" : undefined}>{l}</Link>)}</nav>
        <span className="op-env" title="All PayPal calls go to the sandbox; live is refused"><i />PayPal sandbox</span>
      </header>
      <main className="op-main">
        <div className="op-title"><div><h1>{title}</h1>{sub && <p>{sub}</p>}</div>{aside}</div>
        {children}
      </main>
    </div>
  );
}
