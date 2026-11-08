// Channel3 product search — https://docs.trychannel3.com
import { env } from "./env";

export type Product = {
  id: string;
  title: string;
  brand: string | null;
  price: number;
  currency: string;
  compareAtPrice: number | null;
  merchant: string;
  buyUrl: string;
  image: string | null;
  availability: string;
  category: string | null;
  features: string[];
};

type RawOffer = {
  url: string;
  domain: string;
  price?: { price?: number; compare_at_price?: number | null; currency?: string };
  availability?: string;
};
type RawProduct = {
  id: string;
  title: string;
  brands?: { name: string }[];
  images?: { url: string; is_main_image?: boolean }[];
  category?: { title?: string } | null;
  key_features?: string[];
  offers?: RawOffer[];
};

const cache = new Map<string, { at: number; products: Product[] }>();
const TTL_MS = 10 * 60 * 1000;

export async function searchProducts(opts: {
  query: string;
  maxPrice?: number;
  minPrice?: number;
  limit?: number;
}): Promise<Product[]> {
  const body: Record<string, unknown> = {
    query: opts.query,
    limit: Math.min(opts.limit ?? 8, 20),
    filters: {
      availability: ["InStock"],
      ...(opts.maxPrice || opts.minPrice
        ? { price: { ...(opts.minPrice ? { min_price: opts.minPrice } : {}), ...(opts.maxPrice ? { max_price: opts.maxPrice } : {}) } }
        : {}),
    },
  };
  const key = JSON.stringify(body);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.products;

  const res = await fetch(`${env.channel3Base()}/search`, {
    method: "POST",
    headers: {
      "x-api-key": env.channel3Key(),
      "x-user-id": "guarded-shopping-agent-demo",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Channel3 search failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { products: RawProduct[] };

  const products: Product[] = [];
  for (const p of data.products ?? []) {
    // Cheapest in-stock USD offer.
    const offer = (p.offers ?? [])
      .filter((o) => o.price?.price != null && (o.price?.currency ?? "USD") === "USD")
      .sort((a, b) => (a.price!.price! - b.price!.price!))[0];
    if (!offer) continue;
    const img = p.images?.find((i) => i.is_main_image) ?? p.images?.[0];
    products.push({
      id: p.id,
      title: p.title,
      brand: p.brands?.[0]?.name ?? null,
      price: offer.price!.price!,
      currency: "USD",
      compareAtPrice: offer.price?.compare_at_price ?? null,
      merchant: offer.domain,
      buyUrl: offer.url,
      image: img?.url ?? null,
      availability: offer.availability ?? "Unknown",
      category: p.category?.title ?? null,
      features: (p.key_features ?? []).slice(0, 4),
    });
  }
  cache.set(key, { at: Date.now(), products });
  return products;
}
