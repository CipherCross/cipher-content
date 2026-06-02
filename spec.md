# Cipher Content — Product Spec

A SaaS platform for managing and AI-generating social media content across multiple accounts. Initial scope targets **LinkedIn**. Content is organized hierarchically — **Accounts → Campaigns → Posts** — with AI generation triggered at the campaign level and a daily **Today** view for manual posting.

---

## Tech Stack

| Layer | Choice |
|---|---|
| Frontend | React (hosted on **Vercel**) |
| Backend / DB / Auth | **Supabase** (Postgres + Auth) |
| Auth method | Email / password |
| AI provider | **Claude API** (Anthropic) |
| AI execution | **Supabase Edge Function** — Claude API key stored as a server-side secret, never exposed to the frontend |

---

## Workspace & Roles

- Every user signs in via Supabase email/password auth. Accounts are **created by an admin** (no self sign-up).
- **Shared workspace:** all logged-in users see and can edit the same Accounts, Campaigns and Posts (full visibility).
- Two roles:
  - **admin** — everything members can do, plus manage users (create with email/password, delete, change role).
  - **member** — full access to content, but cannot manage users.
- Row-level security: content tables are readable/writable by any authenticated user; the `users` table is readable by all but only mutable by admins. User creation/deletion runs through an admin-only Edge Function using the service role.
- The first admin is bootstrapped by promoting a user directly in SQL (see README); `accounts.user_id` is retained only as "created by" metadata.

---

## Timezone Handling

- **Default timezone: CET.** Users are based in the EU and Ukraine.
- The UI adapts to the **browser's timezone** for display and for computing what counts as "today."
- `scheduled_at` and all timestamps are stored in **UTC**; conversion happens at the display layer.

---

## Entities & Data Model

### User
Maps to a Supabase Auth user.

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | Matches the Supabase Auth user id |
| `email` | string | From auth |
| `timezone` | string | IANA tz; defaults to CET, overridable; browser tz used when present |
| `created_at` | timestamp | |

### Account
A named social profile the user manages.

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | |
| `user_id` | fk → User | Owner |
| `platform` | enum | `linkedin` (only, for now) |
| `display_name` | string | Custom label set by user |
| `linkedin_url` | string | Optional; display/convenience link to the profile (not used for any automation) |
| `created_at` | timestamp | |

### Campaign
A thematic container for posts, tied to one Account.

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | |
| `account_id` | fk → Account | |
| `title` | string | e.g. "Q3 Thought Leadership" |
| `description` | string | Human-facing summary of purpose/audience; also given to the AI as context |
| `ai_instructions` | string | Per-campaign tone/voice guidance for the AI (editable on the campaign view) |
| `status` | enum | `draft`, `active`, `completed` — **auto-derived from posts** (see below), not set manually |
| `created_at` | timestamp | |

Campaign status is maintained automatically from its posts:
- **draft** — no posts, or all posts still `pending` (setup phase)
- **active** — at least one post `generated`/`approved`/`posted`, but not all posted
- **completed** — at least one post and all posts `posted`

### Post
A single piece of content within a Campaign. (The earlier separate "Schedule Entry" table has been collapsed into Post — a `pending` post with no body represents a planned-but-ungenerated slot.)

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | |
| `campaign_id` | fk → Campaign | |
| `theme` | string | Topic/title — drives AI generation |
| `position` | int | Ordering within the campaign (drag-to-reorder) |
| `body` | text | Generated or manually written content; empty while `pending` |
| `image_url` | string | Optional **Google Drive** URL to an image |
| `status` | enum | `pending`, `generated`, `approved`, `posted` (see lifecycle) |
| `scheduled_at` | timestamp | Optional target posting date/time (UTC). Independent of status. |
| `posted_at` | timestamp | Set when user marks it posted |
| `created_at` | timestamp | |

---

## Post Status Lifecycle

Content readiness is a **linear** chain:

```
pending → generated → approved → posted
```

| Status | Meaning | How it's reached |
|---|---|---|
| `pending` | Slot planned (theme set), no body yet | Created as a theme, or manually with no body |
| `generated` | AI produced a body, awaiting review | **Generate** |
| `approved` | User reviewed and marked content ready | **Approve** (user may edit body first) |
| `posted` | Marked as posted via Today | **Posted** button in Today |

Notes:
- **`scheduled_at` is orthogonal to status.** A date can be assigned at any stage, including while `pending`. Scheduling is planning, not a content state.
- **Regenerate** overwrites the body in place and moves the post back to `generated` (re-approval required). No version history in v1.
- **Manual posts** start at `generated` if created with a body, or `pending` if created empty.

---

## User Flows

### 1. Account Setup
1. User clicks **Add Account**.
2. Selects platform (LinkedIn).
3. Sets a custom display name.
4. Optionally pastes the LinkedIn profile URL (stored as a convenience link).
5. Account is saved and appears in the account list.

### 2. Campaign Creation
1. User selects an Account, clicks **New Campaign**.
2. Fills in title + description (description informs AI tone/context).
3. Status starts `draft` and updates itself as posts progress.
4. User enters the campaign view.

### 3. Theme Setup
Inside a campaign, before generating:
1. User adds **themes** — each creates a `pending` post (short title like "Why async-first teams win").
2. Posts can be reordered (drag-and-drop, updates `position`).
3. This ordered list drives what gets generated and the order bulk date-assignment walks.

### 4. Post Generation
1. User clicks **Generate** (per-post or bulk for all `pending` posts).
2. Generation runs **asynchronously** in a Supabase Edge Function (avoids request timeouts for large batches).
3. For each post, the function sends theme + campaign description + account context to Claude.
4. As each completes, the post flips `pending → generated`; the UI updates live (Supabase realtime / polling).
5. User reviews, edits body, or regenerates individual posts.
6. User clicks **Approve** → `generated → approved`.

### 5. Post Management
- View all posts in a campaign as a list or calendar.
- Edit any field on a post at any time.
- Manually create posts (with or without a body).
- **Bulk-assign dates** — apply `scheduled_at` to many posts at once via a recurrence rule (see below).

### 6. Bulk Date Assignment
A scheduling helper that fills `scheduled_at` across a set of posts from a simple rule.

**Inputs:**
- **Start date** — when the first post goes out.
- **Cadence** — `every day`, `every weekday` (Mon–Fri), `every N days`, or `weekly on [selected weekdays]`.
- **Time of day** — optional; applied to each `scheduled_at` (defaults to **09:00 CET** when not given).
- **Scope** — all posts in the campaign, or a selected subset.

**Behavior:**
1. Posts are taken in `position` order.
2. The rule walks forward from the start date, assigning the next valid slot to each post in turn (e.g. "every weekday starting Mon" → post 1 Mon, post 2 Tue, … skipping weekends).
3. Each post's `scheduled_at` is set. Status is unaffected (scheduling is independent of readiness).
4. Re-running overwrites existing `scheduled_at` values within the chosen scope, behind a confirmation prompt.

### 7. Today (Daily Posting)
A top-level view, **across all accounts**, for executing the day's posts. "Today" is computed in the browser's timezone.

**Ready to post** — posts where `scheduled_at` is today, a body exists, and status is not `posted`:
- Each row shows: account name, theme, body preview, and the optional Google Drive image link.
- **Copy** button — copies the full post body to clipboard for manual pasting into LinkedIn. (Images are attached manually on LinkedIn; the Drive link is shown as a reminder.)
- **Posted** button — sets status `posted` and `posted_at`; the row leaves the list.
- Rows are grouped/sortable by account for batch posting.

**Needs generation** — posts where `scheduled_at` is today but status is `pending` (no body):
- Each row offers a **Generate** button to produce the body, after which it moves up to "Ready to post."

---

## Navigation Structure

```
App
├── Today (daily posting queue)
├── Accounts (list)
│   └── Account Detail
│       └── Campaigns (list)
│           └── Campaign Detail
│               └── Posts (list / calendar)
│                   └── Post Detail / Editor
```

---

## AI Generation — Inputs & Contract

Each generation call sends to Claude:
- **Campaign description** — audience, purpose, context
- **AI instructions** — per-campaign tone/voice guidance (when set)
- **Theme** — the specific topic/title for this post
- **Platform** — LinkedIn (max **3000 characters**; professional tone, hook-first, with the strongest line up front since LinkedIn truncates at ~210 chars in feed)
- **Account display name** — for first-person voice consistency

Output:
- `body` — ready-to-publish post text

Future: hashtag suggestions, image-prompt generation.

---

## Deletion

- Deletes **cascade**: deleting an Account removes its Campaigns and their Posts; deleting a Campaign removes its Posts.
- The user is shown a **confirmation alert** stating what will be removed before a cascading delete proceeds.
- Hard delete in v1 (no soft-delete / trash).

---

## Out of Scope for v1

- Direct publishing / LinkedIn API integration (posting is manual via Today + Copy)
- Analytics or performance tracking
- Platforms other than LinkedIn
- Image generation or upload (image is a linked Google Drive URL only)
- Approval comments / multi-step review workflows
- Post version history

---

## Resolved Decisions

- **No cost controls** on generation/regeneration in v1 (no per-campaign or per-user limits).
- **Default posting time** for bulk-assign when none is given: **09:00 CET**.
- **`linkedin_url`** kept on Account as an optional display/convenience link, not used for any automation.
