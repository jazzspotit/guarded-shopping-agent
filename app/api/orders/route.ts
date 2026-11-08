// Order timeline for the UI (polled). Includes webhook events as they arrive.
import { NextResponse } from "next/server";
import { store } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  const orders = [...store.orders.values()]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 10)
    .map(({ product, ...o }) => ({ ...o, product: { title: product.title, price: product.price, image: product.image, merchant: product.merchant } }));
  return NextResponse.json({ orders });
}
