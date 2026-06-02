// Supabase Edge Function: generate-posts
//
// Generates LinkedIn post bodies for one or more posts using the Claude API.
// The Anthropic key lives ONLY here as a server secret:
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
//
// Auth: the caller's JWT is forwarded to a Supabase client so that all reads
// and writes go through RLS — a user can only ever touch their own posts.
//
// Request body: { "postIds": ["uuid", ...], "instruction"?: "make it shorter" }
// `instruction` is an optional one-off nudge applied to this generation.
// Each named post is generated sequentially; on success it flips to `generated`.

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return jsonResponse({ error: "Missing Authorization header" }, 401);
  }

  let postIds: string[];
  let instruction: string | undefined;
  try {
    const body = await req.json();
    postIds = body.postIds;
    instruction = body.instruction;
    if (!Array.isArray(postIds) || postIds.length === 0) {
      return jsonResponse({ error: "postIds must be a non-empty array" }, 400);
    }
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  // RLS-respecting client: forwards the caller's JWT.
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  const results: { id: string; ok: boolean; error?: string }[] = [];

  for (const id of postIds) {
    try {
      const { data: post, error } = await supabase
        .from("posts")
        .select(
          "id, theme, campaigns(description, ai_instructions, accounts(display_name))",
        )
        .eq("id", id)
        .single();

      if (error || !post) throw new Error(error?.message ?? "Post not found");

      const generatedBody = await callClaude(
        ANTHROPIC_API_KEY,
        buildPostPrompt(post as unknown as PostContext, instruction),
      );

      const { error: updateError } = await supabase
        .from("posts")
        .update({ body: generatedBody, status: "generated" })
        .eq("id", id);

      if (updateError) throw new Error(updateError.message);

      results.push({ id, ok: true });
    } catch (e) {
      results.push({ id, ok: false, error: (e as Error).message });
    }
  }

  return jsonResponse({ results }, 200);
});
