// In-memory state for the demo (single Render instance).
// Products are cached server-side so the agent can only buy what Channel3 actually returned,
// at the price Channel3 returned — the model never supplies a price.

import type { Product } from "./channel3";

export type OrderEvent = { at: string; type: string; detail?: string };

export type OrderRecord = {
  orderId: string;
  product: Product;
  status: string;
  approveUrl?: string;
  captureId?: string;
  refundId?: string;
  createdAt: string;
  events: OrderEvent[];
};

type Store = {
  products: Map<string, Product>;
  orders: Map<string, OrderRecord>;
};

// Survive Next.js dev hot-reloads.
const g = globalThis as unknown as { __gsaStore?: Store };
export const store: Store = g.__gsaStore ?? (g.__gsaStore = { products: new Map(), orders: new Map() });

export function rememberProducts(products: Product[]) {
  for (const p of products) store.products.set(p.id, p);
}

export function addOrderEvent(orderId: string, type: string, detail?: string, status?: string) {
  const rec = store.orders.get(orderId);
  if (!rec) return;
  rec.events.push({ at: new Date().toISOString(), type, detail });
  if (status) rec.status = status;
}
