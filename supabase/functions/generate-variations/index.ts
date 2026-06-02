// Supabase Edge Function: generate-variations
//
// Produces N alternative bodies for a single post WITHOUT saving them.
// The client shows them in a picker; the chosen one is saved by the frontend.
//
// Request body: { "postId": "uuid", "count"?: 3, "instruction"?: "..." }
// Response:     { "variations": ["…", "…", "…"] }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  buildPostPrompt,
  callClaude,
  corsHeaders,
  jsonResponse,
  type PostContext,
} from "../_shared/claude.ts";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const MAX_VARIATIONS = 5;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return jsonResponse({ error: "Missing Authorization header" }, 401);
  }

  let postId: string;
  let count: number;
  let instruction: string | undefined;
  try {
    const body = await req.json();
    postId = body.postId;
    count = Math.max(2, Math.min(MAX_VARIATIONS, Number(body.count) || 3));
    instruction = body.instruction;
    if (!postId) return jsonResponse({ error: "postId is required" }, 400);
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: post, error } = await supabase
    .from("posts")
    .select("id, theme, campaigns(description, ai_instructions, accounts(display_name))")
    .eq("id", postId)
    .single();

  if (error || !post) {
    return jsonResponse({ error: error?.message ?? "Post not found" }, 404);
  }

  // Generate the variations in parallel; each gets a distinctness nudge so the
  // options don't collapse into near-duplicates.
  const ctx = post as unknown as PostContext;
  const tasks = Array.from({ length: count }, (_, i) => {
    const variationNudge = [
      instruction,
      `This is variation ${i + 1} of ${count}; make it distinctly different in ` +
        "angle/hook from the others.",
    ]
      .filter(Boolean)
      .join(" ");
    return callClaude(ANTHROPIC_API_KEY, buildPostPrompt(ctx, variationNudge));
  });

  try {
    const variations = await Promise.all(tasks);
    return jsonResponse({ variations: variations.filter(Boolean) }, 200);
  } catch (e) {
    return jsonResponse({ error: (e as Error).message }, 502);
  }
});
