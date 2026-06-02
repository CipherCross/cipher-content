# Cipher Content

SaaS for managing and AI-generating LinkedIn content. **Accounts → Campaigns → Posts**, with Claude-powered generation and a daily **Today** posting queue. See [`spec.md`](./spec.md) for the full product spec.

## Stack

- **Frontend:** React + Vite + TypeScript (deploy to Vercel)
- **Backend:** Supabase (Postgres + Auth + Edge Functions)
- **AI:** Claude API, called from a Supabase Edge Function (key never touches the browser)

## Local setup

1. Install deps:
   ```bash
   npm install
   ```
2. Create a Supabase project, then copy env:
   ```bash
   cp .env.example .env
   ```
   Fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from your project settings.
3. Apply the schema (SQL editor or Supabase CLI):
   ```bash
   supabase db push        # or paste supabase/migrations/0001_init.sql into the SQL editor
   ```
4. Run the app:
   ```bash
   npm run dev
   ```

## Edge Function (generation)

Set the Claude key as a server secret and deploy the function:

```bash
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
supabase functions deploy generate-posts
supabase functions deploy generate-themes
supabase functions deploy generate-variations
supabase functions deploy admin-users
```

> `admin-users` uses the service role key, but you do **not** set it — Supabase
> auto-injects `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`
> into every Edge Function. (The CLI even refuses secrets with the `SUPABASE_`
> prefix for this reason.)

- `generate-posts` — writes a post body from its theme + campaign context.
  Accepts an optional `instruction` nudge (e.g. "shorter, add a stat").
- `generate-themes` — drafts a batch of theme titles for the "Generate themes"
  modal (returns proposals only; the user edits/approves before they're saved).
- `generate-variations` — returns N alternative bodies for one post without
  saving; the user picks one in the variations picker.
- `admin-users` — admin-only create/delete/set-role for users (uses the service
  role key; verifies the caller is an admin first).

Shared prompt/Claude helpers live in `supabase/functions/_shared/claude.ts`.

## Roles & shared workspace

All logged-in users share the same accounts, campaigns and posts (full read/write).
Only **admins** can manage users (the Users page + nav appear for admins only).

**Bootstrap the first admin** (can't be done from the UI — that requires already
being an admin). After applying the migrations and signing in once with your
account, run this in the Supabase SQL editor:

```sql
update public.users set role = 'admin' where email = 'you@example.com';
```

From then on, create additional users (member or admin) from the **Users** page.

The function (`supabase/functions/generate-posts`) forwards the caller's JWT so all
writes go through RLS — users can only generate their own posts.

## Project layout

```
src/
  context/AuthContext.tsx   email/password auth state
  lib/supabase.ts           browser Supabase client (anon key)
  lib/types.ts              domain types mirroring the schema
  lib/schedule.ts           bulk date-assignment rule engine
  components/               Layout, PostCard
  pages/                    Login, Today, Accounts, AccountDetail, CampaignDetail
supabase/
  migrations/0001_init.sql  schema, enums, RLS policies
  functions/generate-posts  Claude generation Edge Function
```

## Status model

Content readiness is linear: `pending → generated → approved → posted`.
`scheduled_at` is an independent field (you can schedule a `pending` slot), which is
why **Today** has both a "Ready to post" and a "Needs generation" section.
