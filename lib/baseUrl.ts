import { env } from "./env";

/** Public URL of this app, used for PayPal return/cancel URLs. */
export function baseUrlFrom(req: Request): string {
  const configured = env.appBaseUrl();
  if (configured) return configured.replace(/\/$/, "");
  const h = req.headers;
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}
