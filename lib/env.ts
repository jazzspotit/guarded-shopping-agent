// Central place to read configuration. Secrets only ever come from the environment.

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name}. See .env.example`);
  return v;
}

export const env = {
  paypalBase: () => process.env.PAYPAL_API_BASE || "https://api-m.sandbox.paypal.com",
  paypalClientId: () => required("PAYPAL_CLIENT_ID"),
  paypalClientSecret: () => required("PAYPAL_CLIENT_SECRET"),
  paypalWebhookId: () => process.env.PAYPAL_WEBHOOK_ID || "",
  channel3Key: () => required("CHANNEL3_API_KEY"),
  channel3Base: () => process.env.CHANNEL3_API_BASE || "https://api.trychannel3.com/v1",
  appBaseUrl: () => process.env.APP_BASE_URL || "",
};
