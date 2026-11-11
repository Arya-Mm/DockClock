import { createHoldOrder } from "@dockclock/paypal";
const r = await createHoldOrder("PROBE-" + Date.now(), 5000, "DockClock dock-time hold (probe)");
console.log(JSON.stringify({ status: r.status, debugId: r.debugId, id: r.data.id, orderStatus: r.data.status, links: r.data.links?.map((l) => l.rel + " " + l.href) }));
