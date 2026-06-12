import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { isStale, reportStats, timeAgo, type StatValues } from "../lib/stats";

// Posted post joined with names and its LATEST stats snapshot (limit-1 embed).
interface StatsPost {
  id: string;
  theme: string;
  posted_at: string | null;
  linkedin_url: string | null;
  campaigns: {
    id: string;
    title: string;
    accounts: { id: string; display_name: string } | null;
  } | null;
  post_stats: (StatValues & { recorded_at: string })[];
}

type Snapshot = StatValues & { recorded_at: string };

export default function Stats() {
  const [posts, setPosts] = useState<StatsPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [accountId, setAccountId] = useState("");
  const [campaignId, setCampaignId] = useState("");
  const [needsUpdateFirst, setNeedsUpdateFirst] = useState(true);

  async function load() {
    const { data } = await supabase
      .from("posts")
      .select(
        "id, theme, posted_at, linkedin_url, campaigns(id, title, accounts(id, display_name)), post_stats(views, likes, comments, recorded_at)",
      )
      .eq("status", "posted")
      .order("posted_at", { ascending: false })
      .order("recorded_at", { referencedTable: "post_stats", ascending: false })
      .limit(1, { referencedTable: "post_stats" });
    if (data) setPosts(data as unknown as StatsPost[]);
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, []);

  // Filter options come from the loaded posts — no extra queries.
  const accounts = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of posts) {
      const a = p.campaigns?.accounts;
      if (a) map.set(a.id, a.display_name);
    }
    return [...map.entries()];
  }, [posts]);

  const campaigns = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of posts) {
      if (accountId && p.campaigns?.accounts?.id !== accountId) continue;
      if (p.campaigns) map.set(p.campaigns.id, p.campaigns.title);
    }
    return [...map.entries()];
  }, [posts, accountId]);

  function needsUpdate(p: StatsPost): boolean {
    const latest = p.post_stats[0];
    return !latest || isStale(latest.recorded_at);
  }

  const visible = useMemo(() => {
    let list = posts;
    if (accountId) list = list.filter((p) => p.campaigns?.accounts?.id === accountId);
    if (campaignId) list = list.filter((p) => p.campaigns?.id === campaignId);
    if (!needsUpdateFirst) return list;
    // Stable partition: never-reported / stale rows first, newest-posted first
    // within each group (the query already ordered by posted_at desc).
    return [...list.filter(needsUpdate), ...list.filter((p) => !needsUpdate(p))];
  }, [posts, accountId, campaignId, needsUpdateFirst]);

  return (
    <div>
      <h2>Stats</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        Report views, likes and comments for posted posts. Numbers save when you
        leave a row — re-report any time to update older posts.
      </p>

      <div className="card row" style={{ gap: 10, flexWrap: "wrap" }}>
        <select
          value={accountId}
          onChange={(e) => {
            setAccountId(e.target.value);
            setCampaignId("");
          }}
          style={{ width: 200 }}
        >
          <option value="">All accounts</option>
          {accounts.map(([id, name]) => (
            <option key={id} value={id}>{name}</option>
          ))}
        </select>
        <select
          value={campaignId}
          onChange={(e) => setCampaignId(e.target.value)}
          style={{ width: 220 }}
        >
          <option value="">All campaigns</option>
          {campaigns.map(([id, title]) => (
            <option key={id} value={id}>{title}</option>
          ))}
        </select>
        <label className="row" style={{ gap: 6, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={needsUpdateFirst}
            onChange={(e) => setNeedsUpdateFirst(e.target.checked)}
          />
          Needs update first
        </label>
      </div>

      {loading ? (
        <div className="loading-row"><span className="spinner" /> Loading…</div>
      ) : visible.length === 0 ? (
        <div className="empty">
          No posted posts yet — stats can be reported once posts are marked posted.
        </div>
      ) : (
        <div className="stats-table-wrap">
          <table className="stats-table">
            <thead>
              <tr>
                <th>Post</th>
                <th>Posted</th>
                <th className="num">Views</th>
                <th className="num">Likes</th>
                <th className="num">Comments</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((p) => (
                <StatsRow key={p.id} post={p} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StatsRow({ post }: { post: StatsPost }) {
  // Latest snapshot is row-local so a save updates in place without reloading
  // (and re-sorting) the whole grid mid-sweep.
  const [latest, setLatest] = useState<Snapshot | null>(post.post_stats[0] ?? null);
  const [views, setViews] = useState(latest ? String(latest.views) : "");
  const [likes, setLikes] = useState(latest ? String(latest.likes) : "");
  const [comments, setComments] = useState(latest ? String(latest.comments) : "");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const savingRef = useRef(false);

  function parseField(value: string, fallback: number): number | null {
    if (value.trim() === "") return fallback; // untouched field keeps prior value
    const n = Number(value);
    return Number.isInteger(n) && n >= 0 ? n : null;
  }

  async function save() {
    if (savingRef.current) return;
    const next = {
      views: parseField(views, latest?.views ?? 0),
      likes: parseField(likes, latest?.likes ?? 0),
      comments: parseField(comments, latest?.comments ?? 0),
    };
    if (next.views === null || next.likes === null || next.comments === null) {
      setError("Whole numbers only.");
      return;
    }
    // Nothing entered yet, or values identical to the latest snapshot — no-op.
    if (!latest && views === "" && likes === "" && comments === "") return;
    if (
      latest &&
      next.views === latest.views &&
      next.likes === latest.likes &&
      next.comments === latest.comments
    )
      return;

    savingRef.current = true;
    setError(null);
    const { error } = await reportStats(post.id, next as StatValues);
    savingRef.current = false;
    if (error) {
      setError(error.message);
      return;
    }
    const snap: Snapshot = { ...(next as StatValues), recorded_at: new Date().toISOString() };
    setLatest(snap);
    setViews(String(snap.views));
    setLikes(String(snap.likes));
    setComments(String(snap.comments));
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  // Save when focus leaves the row entirely (cell-to-cell moves don't fire).
  function onRowBlur(e: React.FocusEvent<HTMLTableRowElement>) {
    if (e.relatedTarget && e.currentTarget.contains(e.relatedTarget as Node)) return;
    void save();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") void save();
  }

  const stale = !latest || isStale(latest.recorded_at);

  const cell = (value: string, set: (v: string) => void, label: string) => (
    <td className="num">
      <input
        type="number"
        min={0}
        inputMode="numeric"
        placeholder="—"
        aria-label={label}
        value={value}
        onChange={(e) => set(e.target.value)}
        onKeyDown={onKeyDown}
      />
    </td>
  );

  return (
    <tr onBlur={onRowBlur}>
      <td>
        <div className="stats-post-theme">
          {post.linkedin_url ? (
            <a href={post.linkedin_url} target="_blank" rel="noreferrer">
              {post.theme} ↗
            </a>
          ) : (
            post.theme
          )}
        </div>
        <div className="muted" style={{ fontSize: 12 }}>
          {post.campaigns?.accounts?.display_name ?? "—"} ·{" "}
          {post.campaigns?.title ?? "—"}
        </div>
      </td>
      <td className="muted" style={{ whiteSpace: "nowrap" }}>
        {post.posted_at
          ? new Date(post.posted_at).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
            })
          : "—"}
      </td>
      {cell(views, setViews, "Views")}
      {cell(likes, setLikes, "Likes")}
      {cell(comments, setComments, "Comments")}
      <td style={{ whiteSpace: "nowrap" }}>
        {error ? (
          <span className="stat-error">{error}</span>
        ) : saved ? (
          <span className="stat-saved">✓ saved</span>
        ) : !latest ? (
          <span className="stat-stale">never ⚠</span>
        ) : stale ? (
          <span className="stat-stale">{timeAgo(latest.recorded_at)} ⚠</span>
        ) : (
          <span className="muted">{timeAgo(latest.recorded_at)}</span>
        )}
      </td>
    </tr>
  );
}
