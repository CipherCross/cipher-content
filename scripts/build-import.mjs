// One-time import generator (v2): Google "Content Plan" sheet + "Research"
// stats sheet + linked content doc(s) -> scripts/import.sql
//
// Everything heavy stays on disk. Stage the raw exports first (done via the
// Drive MCP, since a plain script can't authenticate to Google):
//   scripts/src/plan.md     -- "Content Plan" spreadsheet (all tabs, markdown)
//   scripts/src/stats.csv   -- "Research" stats sheet (single tab, CSV)
//   scripts/src/doc-*.txt   -- body docs referenced by the plan's "Link to File"
//                              (only the shared ones are reachable; the rest
//                               fall back to the row's brief)
// Outputs:
//   scripts/import.sql        -- transactional wipe + reseed (keeps users/roles)
//   scripts/import-report.md  -- per-account coverage (bodies, stats, articles)
//
// Run: node scripts/build-import.mjs

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

const SRC = "scripts/src";

// Account tabs in the Content Plan, in sheet order. `stats` is the matching
// account label in the Research sheet (null = no stats tracked for it).
const ACCOUNTS = [
  { name: "Mykyta Business", li: "https://www.linkedin.com/in/mykyta-shevchenko-ciphercross-wellness/", stats: "Mykyta Business" },
  { name: "Mykyta Personal", li: "https://www.linkedin.com/in/mykyta-shevchenko-ciphercross/", stats: "Mykyta Personal" },
  { name: "Company Account", li: null, stats: "Company Page" },
  { name: "Anastasia Account", li: null, stats: null },
  { name: "Volodymyr", li: null, stats: null },
  { name: "Yuliia", li: null, stats: null },
];

// ---------------------------------------------------------------- helpers

const unesc = (s) => s.replace(/\\([_&\-.~"'#$%*\[\]()!+])/g, "$1").trim();
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;

function cleanText(s) {
  return s
    .replace(/\\([_&\-.~"'#$%*\[\]()!+])/g, "$1")
    .replace(/\*\*/g, "")
    .replace(/^#+\s*/gm, "")
    // drop design-reference / bare-URL lines (Figma mockups, Drive links)
    .replace(/^\s*<?https?:\/\/\S+>?\s*$/gim, "")
    // strip emoji mojibake: the connector decodes emojis as Latin-1 runs;
    // English post copy uses no chars in this range, so removing is safe
    // (smart quotes/dashes live at U+2018+ and are preserved).
    .replace(/[-ɏ]/g, "")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function tokens(s) {
  return s
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((w) => w.length >= 3);
}

const STOP = new Set(["the", "and", "for", "with", "that", "you", "your", "our", "what", "how", "why", "are", "was", "but", "not", "from", "this", "they", "all", "can", "has", "have", "into", "out", "who", "his", "her", "its", "post", "really", "just", "more", "most", "about", "when", "than", "then", "them", "some", "any"]);

// ---------------------------------------------------------------- plan rows

// Split plan.md into blocks at each header row; map blocks to accounts/articles.
function parsePlan() {
  const md = readFileSync(join(SRC, "plan.md"), "utf8");
  const rows = md
    .split("\n")
    .filter((l) => l.trim().startsWith("|"))
    .map((l) => l.split("|").slice(1, -1).map(unesc));

  const blocks = [];
  let cur = null;
  for (const c of rows) {
    if (/^:?-+:?$/.test(c[0])) continue; // md separator
    const isPostHeader = c[0] === "Topic" && c[1] === "Content ID";
    const isArtHeader = c[0] === "Title" && c[1] === "Format";
    if (isPostHeader || isArtHeader) {
      cur = { kind: isArtHeader ? "articles" : "posts", rows: [] };
      blocks.push(cur);
      continue;
    }
    if (cur) cur.rows.push(c);
  }

  const postBlocks = blocks.filter((b) => b.kind === "posts");
  const artBlock = blocks.find((b) => b.kind === "articles");

  // Posts, grouped by account (post blocks are in the same order as ACCOUNTS).
  const accounts = ACCOUNTS.map((a, i) => {
    const block = postBlocks[i];
    const posts = [];
    let pos = 0;
    for (const c of block ? block.rows : []) {
      const type = (c[4] || "").trim();
      if (!/^LI\b/i.test(type)) continue; // skip month labels, CTA junk, blanks
      const topic = (c[0] || "").trim();
      posts.push({
        topic,
        contentId: (c[1] || "").trim(),
        brief: (c[3] || "").trim(),
        type,
        linkFile: (c[7] || "").trim(),
        publishing: (c[8] || "").trim(),
        postDate: (c[9] || "").trim(),
        postTime: (c[10] || "").trim(),
        position: pos++,
      });
    }
    return { ...a, posts };
  });

  // Articles: [Title, Format, Meta, Keywords, Audience, CTA, Status, Link, PubDate, ID]
  const articles = [];
  for (const c of artBlock ? artBlock.rows : []) {
    const title = (c[0] || "").trim();
    const format = (c[1] || "").trim();
    if (!title || !/^(Blog|News|Article|Case)$/i.test(format)) continue;
    articles.push({
      title,
      format,
      meta: (c[2] || "").trim(),
      keywords: (c[3] || "").trim(),
      audience: (c[4] || "").trim(),
      cta: (c[5] || "").trim(),
      status: (c[6] || "").trim(),
      link: (c[7] || "").trim(),
      pubDate: (c[8] || "").trim(),
    });
  }

  return { accounts, articles };
}

// ---------------------------------------------------------------- body docs

function loadSections() {
  const sections = [];
  for (const f of readdirSync(SRC).filter((f) => /^doc-.*\.txt$/.test(f))) {
    const text = readFileSync(join(SRC, f), "utf8");
    const parts = text.split(/^# /m).slice(1);
    for (const part of parts) {
      const nl = part.indexOf("\n");
      const heading = part.slice(0, nl).trim();
      // Only real numbered post sections ("Post 7", "Autumn Post 3",
      // "Post (2) 4", "Post Main 9"). Skip person-name / questionnaire /
      // one-pager / ratio ("50/50") container sections.
      if (!/(post|autumn)/i.test(heading)) continue;
      if (!/\d\s*$/.test(heading)) continue;
      if (/^\d+\/\d+/.test(heading)) continue;
      const body = cleanText(part.slice(nl + 1));
      if (body.length < 60) continue;
      sections.push({ heading, body, toks: new Set(tokens(body).slice(0, 120)), used: false });
    }
  }
  return sections;
}

// Content-based match: the topic words should appear near the top of the post
// body. Strict on purpose — a wrong body on a live post is worse than a blank
// one the team backfills.
function matchBody(topic, sections) {
  const tks = tokens(topic).filter((t) => !STOP.has(t));
  if (tks.length < 3) return null;
  let best = null;
  let bestScore = 0;
  for (const sec of sections) {
    if (sec.used) continue;
    let hits = 0;
    for (const t of tks) if (sec.toks.has(t)) hits++;
    const score = hits / tks.length;
    if (score > bestScore) {
      bestScore = score;
      best = sec;
    }
  }
  if (best && bestScore >= 0.7) {
    best.used = true;
    return best.body;
  }
  return null;
}

// ---------------------------------------------------------------- dates/times

function parseDate(s) {
  if (!s) return null;
  let m = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
  if (m) return { y: +m[3], mo: +m[2], d: +m[1] };
  m = s.match(/^(\d{1,2})[./](\d{1,2})$/); // no year
  if (m) {
    const mo = +m[2];
    return { y: mo >= 7 ? 2025 : 2026, mo, d: +m[1] };
  }
  return null;
}

// Returns a UTC ISO string. Times are wall-clock in the poster's tz; we apply a
// fixed offset (Kyiv +3 default, New York -4) — approximate, ignores DST.
function toUTC(dateStr, timeStr) {
  const d = parseDate(dateStr);
  if (!d) return null;
  let hour = 9;
  let min = 0;
  let offset = 3; // Kyiv default
  if (timeStr) {
    const tz = timeStr.toLowerCase();
    if (/\(ny\)|\(nyc\)/.test(tz)) offset = -4;
    const t = timeStr.replace(/\([^)]*\)/g, "").trim();
    const tm = t.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
    if (tm) {
      hour = +tm[1];
      min = tm[2] ? +tm[2] : 0;
      const ap = (tm[3] || "").toLowerCase();
      if (ap === "pm" && hour < 12) hour += 12;
      if (ap === "am" && hour === 12) hour = 0;
    }
  }
  const ms = Date.UTC(d.y, d.mo - 1, d.d, hour, min) - offset * 3600 * 1000;
  return new Date(ms).toISOString().replace(".000Z", "Z");
}

// pending -> generated -> approved -> posted (scheduled_at is independent)
function postStatus(publishing) {
  const p = publishing.toLowerCase();
  if (p === "published") return "posted";
  if (p === "scheduled") return "approved";
  if (p === "need to schedule") return "generated";
  return "pending"; // "Not Ready" / blank
}

// ---------------------------------------------------------------- stats sheet

// Research sheet: three 8-col account groups per row (Business / Personal /
// Company), separated by a blank column. Returns {account -> [{date,url,...}]}.
function parseStats() {
  const lines = readFileSync(join(SRC, "stats.csv"), "utf8").split(/\r?\n/);
  const out = { "Mykyta Business": [], "Mykyta Personal": [], "Company Page": [] };
  const groups = [
    { key: "Mykyta Business", base: 0 },
    { key: "Mykyta Personal", base: 9 },
    { key: "Company Page", base: 18 },
  ];
  for (const line of lines) {
    const c = parseCsvLine(line);
    if (!c.length) continue;
    for (const g of groups) {
      const date = (c[g.base] || "").trim();
      if (!/^\d{1,2}\.\d{1,2}\.\d{4}$/.test(date)) continue;
      const num = (v) => (/^\d+$/.test((v || "").trim()) ? +v : 0);
      out[g.key].push({
        date,
        url: (c[g.base + 1] || "").trim(),
        views: num(c[g.base + 3]),
        likes: num(c[g.base + 4]), // "Reactions"
        comments: num(c[g.base + 5]),
      });
    }
  }
  return out;
}

function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let inq = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inq) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') inq = false;
      else cur += ch;
    } else if (ch === '"') inq = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

const ymd = (iso) => (iso ? iso.slice(0, 10) : null);
const dmyToYmd = (s) => {
  const m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : null;
};

// ---------------------------------------------------------------- build

const { accounts, articles } = parsePlan();
const sections = loadSections();
const stats = parseStats();

const report = { accounts: [], articles: { total: articles.length } };
let bodiesFromDoc = 0;
let bodiesFromBrief = 0;
let bodiesEmpty = 0;
let statsMatched = 0;

for (const acc of accounts) {
  for (const p of acc.posts) {
    p.scheduledAt = toUTC(p.postDate, p.postTime);
    p.status = postStatus(p.publishing);
    p.postedAt = p.status === "posted" ? p.scheduledAt : null;
    const body = matchBody(p.topic, sections);
    if (body) { p.body = body; bodiesFromDoc++; }
    else if (p.brief) { p.body = p.brief; bodiesFromBrief++; }
    else { p.body = ""; bodiesEmpty++; }
  }

  // Attach stats + real LinkedIn URL by (account, date).
  const srows = acc.stats ? stats[acc.stats] || [] : [];
  const used = new Set();
  for (const s of srows) {
    const sd = dmyToYmd(s.date);
    const post = acc.posts.find((p, i) => !used.has(i) && ymd(p.scheduledAt) === sd && (used.add(i), true));
    if (post) {
      post.linkedinUrl = s.url || null;
      post.stat = { views: s.views, likes: s.likes, comments: s.comments };
      statsMatched++;
    }
  }

  report.accounts.push({
    name: acc.name,
    posts: acc.posts.length,
    withStats: acc.posts.filter((p) => p.stat).length,
    withDocBody: acc.posts.filter((p) => p.body && p.body === p._docBody).length,
  });
}

// --------------------------------------------------------------- emit SQL

let sql = `-- One-time import of the Content Plan + Research stats + content docs.
-- Generated by scripts/build-import.mjs. Clears ALL content
-- (accounts/campaigns/posts/post_stats/articles); users and roles stay.
-- Requires migrations through 0008 (post_stats, articles). Run as postgres
-- (Supabase Studio SQL editor or psql) — RLS does not apply there.

begin;

delete from public.post_stats;
delete from public.articles;
delete from public.accounts;  -- cascades campaigns -> posts

`;

const firstUser = "(select id from public.users order by created_at asc limit 1)";

for (const acc of accounts) {
  const accId = randomUUID();
  const campId = randomUUID();
  sql += `insert into public.accounts (id, user_id, platform, display_name, linkedin_url)
values (${q(accId)}, ${firstUser}, 'linkedin', ${q(acc.name)}, ${acc.li ? q(acc.li) : "null"});
insert into public.campaigns (id, account_id, title, description, status)
values (${q(campId)}, ${q(accId)}, 'LinkedIn 2026', 'Imported from the Content Plan & Research stats sheets.', 'active');
`;
  for (const p of acc.posts) {
    const id = randomUUID();
    sql += `insert into public.posts (id, campaign_id, theme, position, body, linkedin_url, status, scheduled_at, posted_at)
values (${q(id)}, ${q(campId)}, ${q(p.topic || p.type)}, ${p.position}, ${q(p.body)}, ${p.linkedinUrl ? q(p.linkedinUrl) : "null"}, '${p.status}', ${p.scheduledAt ? q(p.scheduledAt) : "null"}, ${p.postedAt ? q(p.postedAt) : "null"});
`;
    if (p.stat) {
      sql += `insert into public.post_stats (post_id, views, likes, comments, recorded_at)
values (${q(id)}, ${p.stat.views}, ${p.stat.likes}, ${p.stat.comments}, '2026-06-02T12:00:00Z');
`;
    }
  }
  sql += "\n";
}

// Articles
function articleStatus(a) {
  const s = a.status.toLowerCase();
  const sched = toUTC(a.pubDate, null);
  if (s === "published") return { status: "posted", scheduledAt: sched, postedAt: sched };
  if (sched) return { status: "scheduled", scheduledAt: sched, postedAt: null };
  return { status: "draft", scheduledAt: null, postedAt: null };
}

for (const a of articles) {
  const id = randomUUID();
  const st = articleStatus(a);
  // Real body lives in an inaccessible doc; seed with the meta description.
  const body = a.meta || "";
  sql += `insert into public.articles (id, title, body, status, scheduled_at, posted_at, created_by)
values (${q(id)}, ${q(a.title)}, ${q(body)}, '${st.status}', ${st.scheduledAt ? q(st.scheduledAt) : "null"}, ${st.postedAt ? q(st.postedAt) : "null"}, ${firstUser});
`;
}

sql += "\ncommit;\n";
writeFileSync("scripts/import.sql", sql);

// --------------------------------------------------------------- report

const totalPosts = accounts.reduce((n, a) => n + a.posts.length, 0);
let rep = `# Import report

**${totalPosts} posts** across ${accounts.length} accounts · **${articles.length} articles**.

Bodies: ${bodiesFromDoc} from content doc · ${bodiesFromBrief} from brief (doc not shared) · ${bodiesEmpty} empty.
Stats + LinkedIn URL matched on ${statsMatched} posts (Mar–Apr, from the Research sheet).

| Account | Posts | Posted | Scheduled | Pending/Gen | With stats |
| --- | --- | --- | --- | --- | --- |
`;
for (const acc of accounts) {
  const by = (s) => acc.posts.filter((p) => p.status === s).length;
  rep += `| ${acc.name} | ${acc.posts.length} | ${by("posted")} | ${by("approved")} | ${by("pending") + by("generated")} | ${acc.posts.filter((p) => p.stat).length} |\n`;
}
rep += `\nArticles by status: ` +
  ["posted", "scheduled", "draft"].map((s) => `${s}=${articles.filter((a) => articleStatus(a).status === s).length}`).join(" · ") + "\n";
writeFileSync("scripts/import-report.md", rep);

console.log(`posts: ${totalPosts}, articles: ${articles.length}`);
console.log(`bodies: doc=${bodiesFromDoc} brief=${bodiesFromBrief} empty=${bodiesEmpty}, statsMatched=${statsMatched}`);
console.log("wrote scripts/import.sql and scripts/import-report.md");
