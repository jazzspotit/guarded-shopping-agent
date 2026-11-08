// PayPal sends the buyer here after they approve. We capture immediately, then return to the app.
import { NextResponse } from "next/server";
import { captureOrder, firstCapture } from "@/lib/paypal";
import { addOrderEvent, store } from "@/lib/store";
import { baseUrlFrom } from "@/lib/baseUrl";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const orderId = url.searchParams.get("token");
  const base = baseUrlFrom(req);
  if (!orderId) return NextResponse.redirect(`${base}/?checkout=missing`);

  addOrderEvent(orderId, "BUYER_APPROVED", "Buyer approved in PayPal", "APPROVED");
  try {
    const order = await captureOrder(orderId);
    const cap = firstCapture(order);
    const rec = store.orders.get(orderId);
    if (rec && cap) rec.captureId = cap.id;
    addOrderEvent(orderId, "CAPTURED", cap ? `Capture ${cap.id} · $${cap.amount.value}` : undefined, order.status);
    return NextResponse.redirect(`${base}/?order=${encodeURIComponent(orderId)}&status=${order.status}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    addOrderEvent(orderId, "CAPTURE_FAILED", msg, "CAPTURE_FAILED");
    return NextResponse.redirect(
      `${base}/?order=${encodeURIComponent(orderId)}&status=CAPTURE_FAILED&error=${encodeURIComponent(msg.slice(0, 200))}`,
    );
  }
}
