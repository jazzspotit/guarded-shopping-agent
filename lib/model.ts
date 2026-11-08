// Pick the LLM from env so the same code runs on Anthropic, OpenAI or Google.
import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import { google } from "@ai-sdk/google";
import type { LanguageModel } from "ai";

const DEFAULTS = {
  anthropic: "claude-sonnet-4-5",
  openai: "gpt-4.1-mini",
  google: "gemini-2.5-flash",
} as const;

type Provider = keyof typeof DEFAULTS;

export function getModel(): { model: LanguageModel; label: string } {
  const provider = (process.env.AI_PROVIDER || detect()) as Provider;
  const id = process.env.AI_MODEL || DEFAULTS[provider];
  if (!id) throw new Error(`Unknown AI_PROVIDER "${provider}". Use anthropic, openai or google.`);
  const model =
    provider === "anthropic" ? anthropic(id) : provider === "openai" ? openai(id) : google(id);
  return { model, label: `${provider}:${id}` };
}

function detect(): Provider {
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  if (process.env.OPENAI_API_KEY) return "openai";
  if (process.env.GOOGLE_GENERATIVE_AI_API_KEY) return "google";
  throw new Error("No AI key set. Add ANTHROPIC_API_KEY, OPENAI_API_KEY or GOOGLE_GENERATIVE_AI_API_KEY.");
}
