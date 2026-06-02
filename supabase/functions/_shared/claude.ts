// Shared helpers for the post-generation Edge Functions.

export const MODEL = "claude-sonnet-4-6";
export const LINKEDIN_MAX_CHARS = 3000;

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export interface PostContext {
  id: string;
  theme: string;
  body?: string;
  campaigns: {
    description: string;
    ai_instructions: string;
    accounts: { display_name: string } | null;
  } | null;
}

// Builds the post-generation prompt. `instruction` is an optional one-off
// nudge (e.g. "shorter, add a stat") layered on top of campaign settings.
export function buildPostPrompt(ctx: PostContext, instruction?: string): string {
  const campaignDescription = ctx.campaigns?.description ?? "";
  const aiInstructions = ctx.campaigns?.ai_instructions?.trim() ?? "";
  const displayName = ctx.campaigns?.accounts?.display_name ?? "the author";

  const lines = [
    `You are writing a LinkedIn post in the first-person voice of ${displayName}.`,
    "",
    `Campaign context (sets tone, audience, purpose): ${campaignDescription}`,
    `Post theme: ${ctx.theme}`,
  ];
  if (aiInstructions) {
    lines.push("", `Tone & voice instructions (follow strictly): ${aiInstructions}`);
  }
  if (instruction?.trim()) {
    lines.push("", `Additional instruction for this draft: ${instruction.trim()}`);
  }
  lines.push(
    "",
    "Requirements:",
    `- Maximum ${LINKEDIN_MAX_CHARS} characters.`,
    "- Lead with the strongest hook in the first line " +
      "(LinkedIn truncates around 210 characters in the feed).",
    "- No surrounding quotes, no markdown headings — return only the post text.",
  );
  return lines.join("\n");
}

export async function callClaude(
  apiKey: string,
  prompt: string,
  maxTokens = 1500,
): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) {
    throw new Error(`Anthropic API error ${res.status}: ${await res.text()}`);
  }
  const data = await res.json();
  return (data.content?.[0]?.text ?? "").trim();
}

export function jsonResponse(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}
