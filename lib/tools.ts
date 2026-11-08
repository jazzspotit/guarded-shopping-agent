// Agent tools: Channel3 for discovery, PayPal for payment, policy for guardrails.
import { tool } from "ai";
import { z } from "zod";
import { searchProducts } from "./channel3";
import { createOrder, getOrder, refundCapture, firstCapture } from "./paypal";
import { evaluate, type Policy } from "./policy";
import { addOrderEvent, rememberProducts, store } from "./store";

export function buildTools(ctx: { policy: Policy; approvedIds: Set<string>; baseUrl: string }) {
  return {
    search_products: tool({
      description:
        "Search real products from 25,000+ retailers via Channel3. Returns in-stock items with price, merchant and product id. " +
        "Pass the user's budget as max_price so results already respect it.",
      inputSchema: z.object({
        query: z.string().describe("What to search for, e.g. 'gooseneck pour over kettle'"),
        max_price: z.number().optional().describe("Upper price limit in USD"),
        min_price: z.number().optional(),
      }),
      execute: async ({ query, max_price, min_price }) => {
        const cap = Math.min(max_price ?? ctx.policy.budgetUsd, ctx.policy.budgetUsd);
        const products = await searchProducts({ query, maxPrice: cap, minPrice: min_price, limit: 8 });
        rememberProducts(products);
        return {
          count: products.length,
          products: products.slice(0, 6).map((p) => ({
            product_id: p.id,
            title: p.title,
            brand: p.brand,
            price_usd: p.price,
            was_usd: p.compareAtPrice,
            merchant: p.merchant,
            image: p.image,
            features: p.features,
          })),
        };
      },
    }),

    check_policy: tool({
      description:
        "Check a product against the user's spending rules (budget cap, approval threshold, blocked merchants). " +
        "Always call this before create_checkout.",
      inputSchema: z.object({ product_id: z.string() }),
      execute: async ({ product_id }) => {
        const p = store.products.get(product_id);
        if (!p) return { error: "Unknown product_id. Search first." };
        return { product_id, title: p.title, price_usd: p.price, ...evaluate(p, ctx.policy, ctx.approvedIds) };
      },
    }),

    create_checkout: tool({
      description:
        "Create a PayPal order for ONE product the user wants. The price comes from the search result, not from you. " +
        "Blocked items are refused; items needing approval are refused until the user clicks Approve in the app. " +
        "Returns a PayPal approval link — the buyer still confirms payment in PayPal.",
      inputSchema: z.object({
        product_id: z.string(),
        why: z.string().describe("One sentence on why this item fits the request"),
      }),
      execute: async ({ product_id, why }) => {
        const p = store.products.get(product_id);
        if (!p) return { error: "Unknown product_id. Search first." };
        const d = evaluate(p, ctx.policy, ctx.approvedIds);
        if (d.decision !== "allow") {
          return { created: false, product_id, title: p.title, price_usd: p.price, ...d };
        }
        const customId = `gsa-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
        const { id, approveUrl } = await createOrder({
          item: { name: p.title, sku: p.id, url: p.buyUrl.length < 2000 ? p.buyUrl : undefined, price: p.price },
          description: `${p.title} via ${p.merchant}`,
          customId,
          returnUrl: `${ctx.baseUrl}/api/paypal/return`,
          cancelUrl: `${ctx.baseUrl}/api/paypal/cancel`,
        });
        store.orders.set(id, {
          orderId: id,
          product: p,
          status: "PAYER_ACTION_REQUIRED",
          approveUrl,
          createdAt: new Date().toISOString(),
          events: [{ at: new Date().toISOString(), type: "ORDER_CREATED", detail: why }],
        });
        return {
          created: true,
          order_id: id,
          approve_url: approveUrl,
          title: p.title,
          price_usd: p.price,
          merchant: p.merchant,
          image: p.image,
          reasons: d.reasons,
        };
      },
    }),

    get_order_status: tool({
      description: "Get the live PayPal status of an order (CREATED, APPROVED, COMPLETED, ...).",
      inputSchema: z.object({ order_id: z.string() }),
      execute: async ({ order_id }) => {
        const o = await getOrder(order_id);
        const cap = firstCapture(o);
        const rec = store.orders.get(order_id);
        return {
          order_id,
          status: o.status,
          capture: cap ? { id: cap.id, status: cap.status, amount: cap.amount.value } : null,
          title: rec?.product.title,
          timeline: rec?.events ?? [],
        };
      },
    }),

    refund_order: tool({
      description: "Refund a completed order in full (e.g. the user changed their mind). Only use when the user asks.",
      inputSchema: z.object({ order_id: z.string(), reason: z.string() }),
      execute: async ({ order_id, reason }) => {
        const o = await getOrder(order_id);
        const cap = firstCapture(o);
        if (!cap || cap.status !== "COMPLETED") return { refunded: false, error: `Order is ${o.status}; nothing to refund.` };
        const r = await refundCapture(cap.id, reason);
        const rec = store.orders.get(order_id);
        if (rec) rec.refundId = r.id;
        addOrderEvent(order_id, "REFUND_REQUESTED", `Refund ${r.id} · ${r.status}`, r.status === "COMPLETED" ? "REFUNDED" : undefined);
        return { refunded: true, refund_id: r.id, status: r.status, amount: r.amount?.value ?? cap.amount.value };
      },
    }),
  };
}
