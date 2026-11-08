// The guardrails. Enforced in server code, not in the prompt — the model cannot talk its way past them.
import type { Product } from "./channel3";

export type Policy = {
  budgetUsd: number; // hard cap: never buy above this
  approvalThresholdUsd: number; // above this, a human must click "Approve" in the UI
  blockedMerchants: string[]; // e.g. ["example.com"]
};

export const defaultPolicy: Policy = {
  budgetUsd: 60,
  approvalThresholdUsd: 40,
  blockedMerchants: [],
};

export type Decision = {
  decision: "allow" | "needs_approval" | "block";
  reasons: string[];
};

export function sanitizePolicy(input: unknown): Policy {
  const p = (input ?? {}) as Partial<Policy>;
  const num = (v: unknown, d: number) => (typeof v === "number" && isFinite(v) && v >= 0 ? v : d);
  return {
    budgetUsd: num(p.budgetUsd, defaultPolicy.budgetUsd),
    approvalThresholdUsd: num(p.approvalThresholdUsd, defaultPolicy.approvalThresholdUsd),
    blockedMerchants: Array.isArray(p.blockedMerchants)
      ? p.blockedMerchants.filter((m): m is string => typeof m === "string").map((m) => m.trim().toLowerCase()).filter(Boolean)
      : [],
  };
}

export function evaluate(product: Product, policy: Policy, approvedIds: Set<string>): Decision {
  const reasons: string[] = [];
  const merchant = product.merchant.toLowerCase();

  if (policy.blockedMerchants.some((m) => merchant === m || merchant.endsWith(`.${m}`))) {
    return { decision: "block", reasons: [`Merchant ${product.merchant} is on your blocked list.`] };
  }
  if (product.price > policy.budgetUsd) {
    return {
      decision: "block",
      reasons: [`$${product.price.toFixed(2)} is over your $${policy.budgetUsd.toFixed(2)} budget.`],
    };
  }
  if (product.availability !== "InStock") {
    reasons.push(`Availability is "${product.availability}".`);
  }
  if (product.price > policy.approvalThresholdUsd && !approvedIds.has(product.id)) {
    reasons.push(
      `$${product.price.toFixed(2)} is above your $${policy.approvalThresholdUsd.toFixed(2)} auto-approve limit — you must approve it first.`,
    );
    return { decision: "needs_approval", reasons };
  }
  reasons.push(`$${product.price.toFixed(2)} is within budget ($${policy.budgetUsd.toFixed(2)}).`);
  if (approvedIds.has(product.id)) reasons.push("You approved this item.");
  return { decision: "allow", reasons };
}
