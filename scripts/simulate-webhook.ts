// Fires a PayPal simulated webhook at our registered listener. Usage: tsx --env-file=.env scripts/simulate-webhook.ts EVENT_TYPE
import { simulateWebhook } from "@dockclock/paypal";
const r = await simulateWebhook(process.env.PAYPAL_WEBHOOK_ID!, process.argv[2] ?? "PAYMENT.CAPTURE.COMPLETED");
console.log(JSON.stringify({ eventId: r.data.id, type: r.data.event_type, debugId: r.debugId }));
