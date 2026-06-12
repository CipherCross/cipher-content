// One-time import generator: Google Drive stats sheet + content doc → import.sql
//
// Inputs (staged from the Drive connector):
//   scripts/source-stats.md     — data rows of the "Research" sheet (markdown table)
//   scripts/source-content.json — {"fileContent": "..."} dump of the content doc
// Outputs:
//   scripts/import.sql          — transactional seed (clears all content, keeps users)
//   scripts/import-report.md    — per-post match report for human review
//
// Run: node scripts/build-import.mjs

import { readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

const ACCOUNTS = [
  { key: "business", name: "Mykyta Business", li: "https://www.linkedin.com/in/mykyta-shevchenko-ciphercross-wellness/" },
  { key: "personal", name: "Mykyta Personal", li: "https://www.linkedin.com/in/mykyta-shevchenko-ciphercross/" },
  { key: "company", name: "CipherCross Company Page", li: null },
];

// ---------------------------------------------------------------- sheet rows

function unescape(s) {
  return s.replace(/\\([_&\-.~'#$%*[\]()!+])/g, "$1").trim();
}

function parseSheet(md) {
  const rows = [];
  for (const line of md.split("\n")) {
    if (!line.trim().startsWith("|")) continue;
    const cells = line.split("|").slice(1, -1).map(unescape);
    // Each dd.mm.yyyy cell starts an 8-cell group: date, url, type, views,
    // reactions, comments, reposts, new followers. Groups appear in account
    // order: business, personal, company.
    let group = 0;
    for (let i = 0; i < cells.length; i++) {
      const m = cells[i].match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
      if (!m) continue;
      const [, dd, mm, yyyy] = m;
      const num = (v) => (/^\d+$/.test(v) ? Number(v) : 0);
      rows.push({
        account: ACCOUNTS[group].key,
        date: `${yyyy}-${mm}-${dd}`,
        url: cells[i + 1],
        type: cells[i + 2],
        views: num(cells[i + 3]),
        likes: num(cells[i + 4]), // "Reactions" in the sheet
        comments: num(cells[i + 5]),
      });
      group++;
      i += 7;
    }
  }
  return rows;
}

// ----------------------------------------------------------- content doc

function cleanText(s) {
  return s
    .replace(/\\([_&\-.~'#$%*[\]()!+"])/g, "$1")
    .replace(/\*\*/g, "")
    .replace(/^#+\s*/gm, "")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function parseDoc(json) {
  const content = JSON.parse(json).fileContent;
  const sections = [];
  const parts = content.split(/^# /m).slice(1);
  for (const part of parts) {
    const nl = part.indexOf("\n");
    const heading = cleanText(part.slice(0, nl));
    // Only actual post sections, not questionnaires/briefs.
    if (!/^(post|autumn)/i.test(heading)) continue;
    const body = cleanText(part.slice(nl + 1));
    if (body.length < 80) continue;
    sections.push({ heading, body, used: false });
  }
  return sections;
}

// ----------------------------------------------------------- slug matching

function tokens(s) {
  return s
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function slugOf(url) {
  // .../posts/<account>_<slug-words>-activity-<id>-<hash>?...
  const m = url.match(/\/posts\/[^_]+_(.+?)-activity-\d+/);
  return m ? m[1].replace(/-/g, " ") : null;
}

// Greedy in-order subsequence match of slug tokens against the opening of a
// section. LinkedIn slugs are the post's first words with punctuation dropped
// and contractions clipped ("ive", "isn"), so prefix-compare both ways.
function score(slugToks, sectionToks) {
  let si = 0;
  let hits = 0;
  for (const t of slugToks) {
    for (let j = si; j < Math.min(sectionToks.length, si + 6); j++) {
      const w = sectionToks[j];
      if (w === t || w.startsWith(t) || t.startsWith(w)) {
        hits++;
        si = j + 1;
        break;
      }
    }
  }
  return hits / slugToks.length;
}

function matchSection(url, sections) {
  const slug = slugOf(url);
  if (!slug) return { slug: null, section: null, score: 0 };
  const slugToks = tokens(slug);
  let best = null;
  let bestScore = 0;
  for (const sec of sections) {
    if (sec.used) continue;
    const s = score(slugToks, tokens(sec.body).slice(0, 80));
    if (s > bestScore) {
      bestScore = s;
      best = sec;
    }
  }
  // Strict on purpose: a wrong body silently attributed to a live post is far
  // worse than an empty one the SDR backfills. 0.6 admitted false positives.
  if (best && bestScore >= 0.85 && slugToks.length >= 5) {
    best.used = true;
    return { slug, section: best, score: bestScore };
  }
  return { slug, section: null, score: bestScore };
}

// ----------------------------------------------------------------- emit

function q(s) {
  return `'${String(s).replace(/'/g, "''")}'`;
}

function humanize(slug) {
  const t = slug.replace(/\s+/g, " ").trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

const sheet = readFileSync(join(here, "source-stats.md"), "utf8");
const docJson = readFileSync(join(here, "source-content.json"), "utf8");

const rows = parseSheet(sheet);
const sections = parseDoc(docJson);

const accountIds = Object.fromEntries(ACCOUNTS.map((a) => [a.key, randomUUID()]));
const campaignIds = Object.fromEntries(ACCOUNTS.map((a) => [a.key, randomUUID()]));

const posts = [];
const report = [];

for (const acc of ACCOUNTS) {
  const accRows = rows
    .filter((r) => r.account === acc.key)
    .sort((a, b) => a.date.localeCompare(b.date));
  accRows.forEach((r, i) => {
    const { slug, section, score: s } = matchSection(r.url, sections);
    const body = section ? section.body : "";
    const firstLine = body.split("\n").find((l) => l.trim()) ?? "";
    const theme = section
      ? firstLine.trim().slice(0, 60)
      : slug
        ? humanize(slug).slice(0, 60)
        : `${r.type} — ${r.date}`;
    posts.push({
      id: randomUUID(),
      campaign: acc.key,
      position: i,
      theme,
      body,
      url: r.url,
      date: r.date,
      views: r.views,
      likes: r.likes,
      comments: r.comments,
    });
    report.push({
      account: acc.name,
      date: r.date,
      theme,
      matched: !!section,
      heading: section?.heading ?? null,
      score: s,
      slug,
    });
  });
}

let sql = `-- One-time import of Google Drive posts + stats (generated by build-import.mjs).
-- Clears ALL content (accounts/campaigns/posts/stats) — users and roles stay.
-- Run as postgres (Supabase Studio SQL editor or psql); RLS does not apply there.

begin;

delete from public.accounts;

`;

for (const acc of ACCOUNTS) {
  sql += `insert into public.accounts (id, user_id, platform, display_name, linkedin_url)
values (${q(accountIds[acc.key])}, (select id from public.users order by created_at asc limit 1), 'linkedin', ${q(acc.name)}, ${acc.li ? q(acc.li) : "null"});
insert into public.campaigns (id, account_id, title, description, status)
values (${q(campaignIds[acc.key])}, ${q(accountIds[acc.key])}, 'LinkedIn 2026', 'Imported from the Google Drive content plan & stats sheet.', 'active');

`;
}

for (const p of posts) {
  const ts = `${p.date}T09:00:00Z`;
  sql += `insert into public.posts (id, campaign_id, theme, position, body, linkedin_url, status, scheduled_at, posted_at)
values (${q(p.id)}, ${q(campaignIds[p.campaign])}, ${q(p.theme)}, ${p.position}, ${q(p.body)}, ${q(p.url)}, 'posted', ${q(ts)}, ${q(ts)});
insert into public.post_stats (post_id, views, likes, comments, recorded_at)
values (${q(p.id)}, ${p.views}, ${p.likes}, ${p.comments}, '2026-06-02T12:00:00Z');
`;
}

sql += `
commit;
`;

writeFileSync(join(here, "import.sql"), sql);

const matched = report.filter((r) => r.matched);
let md = `# Import report

${posts.length} posts (${rows.length} sheet rows) · ${matched.length} bodies matched from the content doc · ${posts.length - matched.length} without body.

| Account | Date | Matched | Doc section | Score | Theme |
| --- | --- | --- | --- | --- | --- |
`;
for (const r of report) {
  md += `| ${r.account} | ${r.date} | ${r.matched ? "✅" : "—"} | ${r.heading ?? ""} | ${r.score.toFixed(2)} | ${r.theme.replace(/\|/g, "\\|")} |\n`;
}
writeFileSync(join(here, "import-report.md"), md);

console.log(`rows: ${rows.length}, posts: ${posts.length}, matched bodies: ${matched.length}`);
console.log("wrote scripts/import.sql and scripts/import-report.md");
