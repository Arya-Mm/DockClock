// Registers (or reuses) the PayPal webhook for a public base URL and prints its id.
// Usage: tsx --env-file=.env scripts/register-webhook.ts https://<public-host>
import { createWebhook, listWebhooks, WEBHOOK_EVENTS } from "@dockclock/paypal";

const base = process.argv[2];
if (!base?.startsWith("https://")) throw new Error("pass the public https base URL");
const url = `${base.replace(/\/$/, "")}/api/webhooks/paypal`;
const existing = (await listWebhooks()).data.webhooks?.find((w) => w.url === url);
const r = existing ? { id: existing.id, debugId: null } : await createWebhook(url, [...WEBHOOK_EVENTS]).then((x) => ({ id: x.data.id, debugId: x.debugId }));
console.log(JSON.stringify({ webhookId: r.id, url, debugId: r.debugId, reused: !!existing }));
