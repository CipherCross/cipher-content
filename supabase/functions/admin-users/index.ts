// Supabase Edge Function: admin-users
//
// Admin-only user management. Creating/deleting auth users needs the service
// role key, which must never reach the browser — so it lives here as a secret:
//   supabase secrets set SUPABASE_SERVICE_ROLE_KEY=...   (from project settings)
//
// The caller's JWT is checked first: only an admin (public.users.role='admin')
// may perform any action.
//
// Request body:
//   { "action": "create", "email": "...", "password": "...", "role"?: "member"|"admin" }
//   { "action": "delete", "userId": "..." }
//   { "action": "setRole", "userId": "...", "role": "member"|"admin" }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Missing Authorization header" }, 401);

  // 1) Verify the caller is an admin (RLS-respecting client).
  const caller = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData } = await caller.auth.getUser();
  if (!userData?.user) return json({ error: "Not authenticated" }, 401);

  const { data: profile } = await caller
    .from("users")
    .select("role")
    .eq("id", userData.user.id)
    .single();
  if (profile?.role !== "admin") {
    return json({ error: "Admins only" }, 403);
  }

  // 2) Perform the action with the service role.
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  const action = body.action;

  try {
    if (action === "create") {
      const email = String(body.email ?? "").trim();
      const password = String(body.password ?? "");
      const role = body.role === "admin" ? "admin" : "member";
      if (!email || password.length < 6) {
        return json({ error: "Email and a password (min 6 chars) are required" }, 400);
      }
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true, // no verification step; usable immediately
      });
      if (error) throw error;
      // The on_auth_user_created trigger inserts the profile (role=member);
      // bump to admin if requested.
      if (role === "admin" && data.user) {
        await admin.from("users").update({ role }).eq("id", data.user.id);
      }
      return json({ ok: true, userId: data.user?.id }, 200);
    }

    if (action === "delete") {
      const userId = String(body.userId ?? "");
      if (!userId) return json({ error: "userId required" }, 400);
      if (userId === userData.user.id) {
        return json({ error: "You can't delete your own account." }, 400);
      }
      const { error } = await admin.auth.admin.deleteUser(userId);
      if (error) throw error; // public.users cascades via FK
      return json({ ok: true }, 200);
    }

    if (action === "setRole") {
      const userId = String(body.userId ?? "");
      const role = body.role === "admin" ? "admin" : "member";
      if (!userId) return json({ error: "userId required" }, 400);
      if (userId === userData.user.id) {
        return json({ error: "You can't change your own role." }, 400);
      }
      const { error } = await admin.from("users").update({ role }).eq("id", userId);
      if (error) throw error;
      return json({ ok: true }, 200);
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
