# 🛡️ Guarded Shopping Agent

**Give an AI a budget, not your card.**

An AI shopping agent that finds real products with **Channel3**, checks them against **your spending rules**, and buys them with **PayPal** — with guardrails enforced in code, not in the prompt.

> Built for the [PayPal AI Hackathon 2026](https://paypalaihackathon.devpost.com/).

## The problem
AI agents can now shop for us, but handing an agent payment access is scary: it might overspend, buy from a sketchy store, or "hallucinate" a product or price. People need to delegate the boring parts of shopping **without** losing control of their money.

## What it does
1. You say what you need: *"A pour-over kettle for my dad's birthday, under $60."*
2. The agent searches **25,000+ retailers** through Channel3 and shows real, in-stock products.
3. It checks the best pick against **your guardrails**:
   - **Hard budget cap**: anything above it is blocked.
   - **"Ask me above $X"**: pricier items need you to click **Approve**.
   - **Blocked merchants**: never buys from them.
4. It creates a **PayPal order** for that exact product at the price Channel3 returned. The model never supplies a price.
5. You review and pay in PayPal. The app captures the payment and tracks it live (webhooks).
6. Changed your mind? Ask the agent to **refund**, and it calls PayPal's refund API.

Every tool call (Channel3 + PayPal) is shown in the **Agent activity** panel, so you can see exactly what the AI did.

## Why it's safe by design
| Risk | Guardrail | Where |
|---|---|---|
| Overspending | Budget cap checked before any order is created | `lib/policy.ts`, `lib/tools.ts` |
| Big purchases without consent | Items above the threshold are refused until the user clicks **Approve** in the UI | `create_checkout` tool |
| Hallucinated products/prices | Orders can only be created for product IDs returned by Channel3; price comes from the cached search result | `lib/store.ts` |
| Untrusted merchants | Merchant block list | `lib/policy.ts` |
| Agent moving money on its own | The buyer always confirms in PayPal; capture happens only after approval | `app/api/paypal/return` |
| Double charges | `PayPal-Request-Id` idempotency keys on create/capture/refund | `lib/paypal.ts` |

## How PayPal is used
- **Orders v2**: create (`intent: CAPTURE`, itemised with SKU + merchant URL), get, capture
- **Payments v2**: full refunds of captures
- **OAuth2 client credentials** with token caching
- **Webhooks**: `CHECKOUT.ORDER.APPROVED`, `PAYMENT.CAPTURE.COMPLETED/REFUNDED/DENIED` with signature verification (`/v1/notifications/verify-webhook-signature`)
- PayPal checkout experience context (return/cancel URLs, `PAY_NOW`)

## How AI is used
- An LLM agent (Vercel AI SDK, tool calling, multi-step) with five tools: `search_products`, `check_policy`, `create_checkout`, `get_order_status`, `refund_order`
- Works with **Anthropic Claude, OpenAI or Google Gemini**; pick one with an env var
- The model plans, compares options and explains its choice. Code enforces the money rules.

## Architecture
```
Browser (Next.js)  ──►  /api/agent  ──►  LLM (tool calling)
                                   ├──►  search_products  ──► Channel3 /v1/search
                                   ├──►  check_policy     ──► lib/policy.ts (guardrails)
                                   ├──►  create_checkout  ──► PayPal Orders v2
                                   ├──►  get_order_status ──► PayPal Orders v2
                                   └──►  refund_order     ──► PayPal Payments v2
PayPal ──► /api/paypal/return (capture) · /api/paypal/webhook (events) ──► order timeline in UI
```

## Run it locally
Requires Node 20+.
```bash
git clone https://github.com/<you>/guarded-shopping-agent.git
cd guarded-shopping-agent
npm install
cp .env.example .env.local   # fill in the values
npm run dev                  # http://localhost:3000
```
You need:
- **PayPal sandbox app** (developer.paypal.com). Link it to a **US** sandbox business account.
- **Channel3 API key** (trychannel3.com/developers)
- **One LLM key**: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` or `GOOGLE_GENERATIVE_AI_API_KEY`

To test checkout, log in at PayPal with a **sandbox personal (buyer)** account.

## Deploy (Render)
- New **Web Service** from this repo → Build `npm ci && npm run build` → Start `npm start`
- Add the env vars from `.env.example`
- In the PayPal dashboard, add a webhook to `https://<your-app>.onrender.com/api/paypal/webhook` and set `PAYPAL_WEBHOOK_ID`

## Built with
PayPal Orders v2 · PayPal Payments v2 · PayPal Webhooks · Channel3 Product API · Vercel AI SDK · Next.js · TypeScript · Render

## License
MIT
