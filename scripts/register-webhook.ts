// Points the PayPal webhook at a public base URL and prints its id.
// With PAYPAL_WEBHOOK_ID set, the existing webhook is repointed (id stays, so .env and signature checks keep working).
// Usage: tsx --env-file=.env scripts/register-webhook.ts https://<public-host>
import { createWebhook, listWebhooks, updateWebhookUrl, WEBHOOK_EVENTS } from "@dockclock/paypal";

const base = process.argv[2];
if (!base?.startsWith("https://")) throw new Error("pass the public https base URL");
// Quick-tunnel errors print api.trycloudflare.com; never register that.
if (/^https:\/\/api\.trycloudflare\.com/.test(base)) throw new Error("that is the Cloudflare API host, not your tunnel URL");
const url = `${base.replace(/\/$/, "")}/api/webhooks/paypal`;
const id = process.env.PAYPAL_WEBHOOK_ID;
if (id) {
  const r = await updateWebhookUrl(id, url);
  console.log(JSON.stringify({ webhookId: r.data.id, url: r.data.url, debugId: r.debugId, updated: true }));
} else {
  const existing = (await listWebhooks()).data.webhooks?.find((w) => w.url === url);
  const r = existing ? { id: existing.id, debugId: null } : await createWebhook(url, [...WEBHOOK_EVENTS]).then((x) => ({ id: x.data.id, debugId: x.debugId }));
  console.log(JSON.stringify({ webhookId: r.id, url, debugId: r.debugId, reused: !!existing, note: "set PAYPAL_WEBHOOK_ID to this id" }));
}
