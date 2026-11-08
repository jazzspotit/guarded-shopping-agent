// PayPal REST (sandbox) — Orders v2, Payments v2 refunds, webhook verification.
import { env } from "./env";

let tokenCache: { token: string; expiresAt: number } | null = null;

export async function getAccessToken(): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expiresAt - 60_000) return tokenCache.token;
  const basic = Buffer.from(`${env.paypalClientId()}:${env.paypalClientSecret()}`).toString("base64");
  const res = await fetch(`${env.paypalBase()}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`PayPal auth failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { access_token: string; expires_in: number };
  tokenCache = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return data.access_token;
}

async function pp<T>(path: string, init: RequestInit & { requestId?: string } = {}): Promise<T> {
  const token = await getAccessToken();
  const res = await fetch(`${env.paypalBase()}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.requestId ? { "PayPal-Request-Id": init.requestId } : {}),
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const issue = json?.details?.[0]?.issue ?? json?.name ?? res.status;
    throw new Error(`PayPal ${path} failed: ${issue} — ${json?.details?.[0]?.description ?? json?.message ?? text}`);
  }
  return json as T;
}

type Link = { rel: string; href: string };
export type PayPalOrder = {
  id: string;
  status: string;
  links?: Link[];
  payer?: { email_address?: string };
  purchase_units?: {
    payments?: {
      captures?: { id: string; status: string; amount: { value: string; currency_code: string } }[];
      refunds?: { id: string; status: string }[];
    };
  }[];
};

export async function createOrder(opts: {
  item: { name: string; sku: string; url?: string; price: number };
  description: string;
  customId: string;
  returnUrl: string;
  cancelUrl: string;
}): Promise<{ id: string; approveUrl: string }> {
  const value = opts.item.price.toFixed(2);
  const order = await pp<PayPalOrder>("/v2/checkout/orders", {
    method: "POST",
    requestId: `create-${opts.customId}`,
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [
        {
          reference_id: opts.item.sku,
          custom_id: opts.customId,
          description: opts.description.slice(0, 127),
          amount: {
            currency_code: "USD",
            value,
            breakdown: { item_total: { currency_code: "USD", value } },
          },
          items: [
            {
              name: opts.item.name.slice(0, 127),
              sku: opts.item.sku,
              ...(opts.item.url ? { url: opts.item.url } : {}),
              quantity: "1",
              category: "PHYSICAL_GOODS",
              unit_amount: { currency_code: "USD", value },
            },
          ],
        },
      ],
      payment_source: {
        paypal: {
          experience_context: {
            brand_name: "Guarded Shopping Agent",
            user_action: "PAY_NOW",
            shipping_preference: "GET_FROM_FILE",
            return_url: opts.returnUrl,
            cancel_url: opts.cancelUrl,
          },
        },
      },
    }),
  });
  const approveUrl = order.links?.find((l) => l.rel === "payer-action" || l.rel === "approve")?.href;
  if (!approveUrl) throw new Error("PayPal did not return an approval link");
  return { id: order.id, approveUrl };
}

export const getOrder = (id: string) => pp<PayPalOrder>(`/v2/checkout/orders/${encodeURIComponent(id)}`);

export const captureOrder = (id: string) =>
  pp<PayPalOrder>(`/v2/checkout/orders/${encodeURIComponent(id)}/capture`, {
    method: "POST",
    requestId: `capture-${id}`,
  });

export const refundCapture = (captureId: string, note: string) =>
  pp<{ id: string; status: string; amount?: { value: string } }>(
    `/v2/payments/captures/${encodeURIComponent(captureId)}/refund`,
    {
      method: "POST",
      requestId: `refund-${captureId}`,
      body: JSON.stringify({ note_to_payer: note.slice(0, 255) }),
    },
  );

export function firstCapture(order: PayPalOrder) {
  return order.purchase_units?.[0]?.payments?.captures?.[0];
}

/** Verifies a webhook with PayPal. Returns true when PAYPAL_WEBHOOK_ID is unset (local dev). */
export async function verifyWebhook(headers: Headers, event: unknown): Promise<boolean> {
  const webhookId = env.paypalWebhookId();
  if (!webhookId) return true;
  const res = await pp<{ verification_status: string }>("/v1/notifications/verify-webhook-signature", {
    method: "POST",
    body: JSON.stringify({
      auth_algo: headers.get("paypal-auth-algo"),
      cert_url: headers.get("paypal-cert-url"),
      transmission_id: headers.get("paypal-transmission-id"),
      transmission_sig: headers.get("paypal-transmission-sig"),
      transmission_time: headers.get("paypal-transmission-time"),
      webhook_id: webhookId,
      webhook_event: event,
    }),
  });
  return res.verification_status === "SUCCESS";
}
