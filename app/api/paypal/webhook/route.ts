// PayPal webhook receiver. Register https://<your-app>/api/paypal/webhook in the PayPal dashboard
// for CHECKOUT.ORDER.APPROVED, PAYMENT.CAPTURE.COMPLETED, PAYMENT.CAPTURE.REFUNDED, PAYMENT.CAPTURE.DENIED,
// then set PAYPAL_WEBHOOK_ID so signatures are verified.
import { NextResponse } from "next/server";
import { verifyWebhook } from "@/lib/paypal";
import { addOrderEvent, store } from "@/lib/store";

export const dynamic = "force-dynamic";

type WebhookEvent = {
  id: string;
  event_type: string;
  summary?: string;
  resource?: {
    id?: string;
    status?: string;
    supplementary_data?: { related_ids?: { order_id?: string } };
    links?: { rel: string; href: string }[];
  };
};

const STATUS_BY_EVENT: Record<string, string> = {
  "CHECKOUT.ORDER.APPROVED": "APPROVED",
  "PAYMENT.CAPTURE.COMPLETED": "COMPLETED",
  "PAYMENT.CAPTURE.REFUNDED": "REFUNDED",
  "PAYMENT.CAPTURE.DENIED": "DENIED",
};

export async function POST(req: Request) {
  const event = (await req.json()) as WebhookEvent;
  const ok = await verifyWebhook(req.headers, event).catch(() => false);
  if (!ok) return NextResponse.json({ error: "invalid signature" }, { status: 400 });

  const r = event.resource ?? {};
  let orderId = r.supplementary_data?.related_ids?.order_id;
  if (!orderId && event.event_type.startsWith("CHECKOUT.ORDER")) orderId = r.id;
  if (!orderId && event.event_type === "PAYMENT.CAPTURE.REFUNDED") {
    // Refund resources link back to the capture; find the order that owns it.
    const captureHref = r.links?.find((l) => l.rel === "up")?.href ?? "";
    for (const rec of store.orders.values()) if (rec.captureId && captureHref.endsWith(rec.captureId)) orderId = rec.orderId;
  }
  if (orderId) {
    addOrderEvent(orderId, `WEBHOOK ${event.event_type}`, event.summary, STATUS_BY_EVENT[event.event_type]);
  }
  return NextResponse.json({ received: true });
}
