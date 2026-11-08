import { NextResponse } from "next/server";
import { addOrderEvent } from "@/lib/store";
import { baseUrlFrom } from "@/lib/baseUrl";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const orderId = new URL(req.url).searchParams.get("token") ?? "";
  if (orderId) addOrderEvent(orderId, "BUYER_CANCELLED", "Buyer cancelled at PayPal", "CANCELLED");
  return NextResponse.redirect(`${baseUrlFrom(req)}/?order=${encodeURIComponent(orderId)}&status=CANCELLED`);
}
