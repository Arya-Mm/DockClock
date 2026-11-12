export const metadata = { title: "DockClock driver" };

/** Installed-app start page. A driver opens their load from the link dispatch sends (one link per load). */
export default function DriverHome() {
  return (
    <main className="rd-wrap">
      <section className="rd-sign"><div className="rd-sign-inner">
        <span className="rd-place">DockClock</span>
        <span className="rd-clock-unit">Open the load link your dispatcher sent you.</span>
        <span className="rd-sign-line rd-muted">Each load has its own link. It opens your wait clock, offers and pay.</span>
      </div></section>
    </main>
  );
}
