// Supabase Edge Function: generate-themes
//
// Generates a batch of LinkedIn post *themes* (short titles) for a campaign,
// used by the "Generate themes in bulk" modal. Returns proposed themes only —
// the client lets the user edit/approve before they are inserted as posts.
//
// Request body: { "campaignId": "uuid", "count": 12 }
// Response:     { "themes": ["…", "…"] }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const MODEL = "claude-sonnet-4-6";
const MAX_COUNT = 168; // 7/week * 24 weeks

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface CampaignContext {
  title: string;
  description: string;
  ai_instructions: string;
  accounts: { display_name: string } | null;
}

function buildPrompt(ctx: CampaignContext, count: number): string {
  const name = ctx.accounts?.display_name ?? "the author";
  const aiInstructions = ctx.ai_instructions?.trim() ?? "";
  const lines = [
    `You are planning a LinkedIn content calendar for ${name}.`,
    `Campaign title: ${ctx.title}`,
    `Campaign context: ${ctx.description || "(none provided)"}`,
  ];
  if (aiInstructions) {
    lines.push(`Tone & voice instructions: ${aiInstructions}`);
  }
  lines.push(
    "",
    `Propose exactly ${count} distinct post themes that fit this campaign.`,
    "Each theme is a short, specific post title of 3–10 words.",
    "Vary the angles (story, how-to, hot take, lesson, data, question).",
    "Do not number them or add commentary.",
    "",
    'Return ONLY a JSON array of strings, e.g. ["First theme", "Second theme"].',
  );
  return lines.join("\n");
}

function parseThemes(text: string, count: number): string[] {
  // Prefer a clean JSON array; fall back to line-splitting.
  const match = text.match(/\[[\s\S]*\]/);
  if (match) {
    try {
      const arr = JSON.parse(match[0]);
      if (Array.isArray(arr)) {
        return arr.map((t) => String(t).trim()).filter(Boolean).slice(0, count);
      }
    } catch {
      // fall through
    }
  }
  return text
    .split("\n")
    .map((l) => l.replace(/^\s*[-*\d.)\]]+\s*/, "").replace(/^["']|["']$/g, "").trim())
    .filter(Boolean)
    .slice(0, count);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Missing Authorization header" }, 401);

  let campaignId: string;
  let count: number;
  try {
    const body = await req.json();
    campaignId = body.campaignId;
    count = Math.max(1, Math.min(MAX_COUNT, Number(body.count)));
    if (!campaignId || !Number.isFinite(count)) {
      return json({ error: "campaignId and a numeric count are required" }, 400);
    }
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  // RLS-respecting client (forwards the caller's JWT).
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: campaign, error } = await supabase
    .from("campaigns")
    .select("title, description, ai_instructions, accounts(display_name)")
    .eq("id", campaignId)
    .single();

  if (error || !campaign) {
    return json({ error: error?.message ?? "Campaign not found" }, 404);
  }

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 8000,
      messages: [
        {
          role: "user",
          content: buildPrompt(campaign as unknown as CampaignContext, count),
        },
      ],
    }),
  });

  if (!res.ok) {
    return json({ error: `Anthropic API error ${res.status}` }, 502);
  }

  const data = await res.json();
  const themes = parseThemes(data.content?.[0]?.text ?? "", count);
  return json({ themes }, 200);
});

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}
