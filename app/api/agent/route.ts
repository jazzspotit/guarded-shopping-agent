import { NextResponse } from "next/server";
import { generateText, stepCountIs, type ModelMessage } from "ai";
import { getModel } from "@/lib/model";
import { buildTools } from "@/lib/tools";
import { sanitizePolicy } from "@/lib/policy";
import { baseUrlFrom } from "@/lib/baseUrl";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SYSTEM = `You are Guarded Shopping Agent, a careful personal shopper that can actually buy things with PayPal.

How you work:
1. Understand the request (recipient, budget, must-haves). Ask at most one short clarifying question only if truly needed.
2. Call search_products (pass the budget as max_price). Search again with a better query if results are poor.
3. Pick the best 1–3 options and explain briefly why (price, fit, merchant).
4. Before buying, ALWAYS call check_policy for the chosen item.
   - "block": tell the user why and offer the best alternative within the rules.
   - "needs_approval": tell the user it needs their approval and that they can press "Approve" on the item card. Do not call create_checkout until they have.
   - "allow": call create_checkout.
5. After create_checkout, tell the user to review and pay in PayPal using the button. You never move money yourself; the buyer always confirms in PayPal.
6. If the user wants to return/cancel a completed purchase, call refund_order.

Rules: never invent products, prices or links — only use tool results. Prices are USD. Keep replies short and friendly.`;

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      messages: ModelMessage[];
      policy?: unknown;
      approvedIds?: string[];
    };
    const policy = sanitizePolicy(body.policy);
    const approvedIds = new Set((body.approvedIds ?? []).filter((x) => typeof x === "string"));
    const { model, label } = getModel();

    const result = await generateText({
      model,
      system: `${SYSTEM}\n\nCurrent rules: budget $${policy.budgetUsd}, auto-approve up to $${policy.approvalThresholdUsd}${
        policy.blockedMerchants.length ? `, blocked merchants: ${policy.blockedMerchants.join(", ")}` : ""
      }.`,
      messages: body.messages,
      tools: buildTools({ policy, approvedIds, baseUrl: baseUrlFrom(req) }),
      stopWhen: stepCountIs(8),
    });

    const toolEvents = result.steps.flatMap((s) =>
      s.content.flatMap((c) =>
        c.type === "tool-result"
          ? [{ id: c.toolCallId, tool: c.toolName, input: c.input, output: c.output }]
          : c.type === "tool-error"
            ? [{ id: c.toolCallId, tool: c.toolName, input: c.input, output: { error: String(c.error) } }]
            : [],
      ),
    );

    return NextResponse.json({
      text: result.text,
      messages: result.response.messages,
      toolEvents,
      model: label,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[agent]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
