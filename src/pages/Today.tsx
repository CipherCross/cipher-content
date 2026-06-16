import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { isRenderableImage } from "../lib/images";
import type { Article } from "../lib/types";
import PostDetailModal from "../components/PostDetailModal";

// Post joined with its account name, as returned by the query below.
interface TodayPost {
  id: string;
  theme: string;
  body: string;
  image_url: string | null;
  status: string;
  scheduled_at: string;
  campaigns: { title: string; accounts: { display_name: string } | null } | null;
}

function startOfToday(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

// Persisted across sessions — display names of accounts hidden from Today.
// We store *hidden* (not shown) so newly added accounts default to visible.
const HIDDEN_KEY = "cipher.today.hiddenAccounts";

function loadHidden(): Set<string> {
  try {
    const raw = localStorage.getItem(HIDDEN_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

export default function Today() {
  const navigate = useNavigate();
  const [posts, setPosts] = useState<TodayPost[]>([]);
  const [articles, setArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<{ id: string; write: boolean } | null>(null);
  const [accounts, setAccounts] = useState<string[]>([]);
  const [hidden, setHidden] = useState<Set<string>>(loadHidden);

  function toggleAccount(name: string) {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      try {
        localStorage.setItem(HIDDEN_KEY, JSON.stringify([...next]));
      } catch {
        /* ignore quota/availability errors */
      }
      return next;
    });
  }

  async function load() {
    const start = startOfToday();
    const endOfToday = new Date(start);
    endOfToday.setDate(endOfToday.getDate() + 1);
    // Everything due up to the end of today that isn't posted yet — overdue
    // items (before today) are bucketed separately below.
    const { data } = await supabase
      .from("posts")
      .select(
        "id, theme, body, image_url, status, scheduled_at, campaigns(title, accounts(display_name))",
      )
      .lt("scheduled_at", endOfToday.toISOString())
      .neq("status", "posted")
      .order("scheduled_at", { ascending: true });
    if (data) setPosts(data as unknown as TodayPost[]);
    // Scheduled articles due by end of today (overdue ones included).
    const { data: arts } = await supabase
      .from("articles")
      .select("*")
      .eq("status", "scheduled")
      .lt("scheduled_at", endOfToday.toISOString())
      .order("scheduled_at", { ascending: true });
    if (arts) setArticles(arts as Article[]);
    setLoading(false);
  }

  useEffect(() => {
    void load();
    // The full account roster powers the filter, independent of what's due today.
    void supabase
      .from("accounts")
      .select("display_name")
      .order("display_name", { ascending: true })
      .then(({ data }) => {
        if (data) {
          setAccounts(Array.from(new Set(data.map((a) => a.display_name as string))));
        }
      });
  }, []);

  async function markPosted(id: string) {
    await supabase
      .from("posts")
      .update({ status: "posted", posted_at: new Date().toISOString() })
      .eq("id", id);
    void load();
  }

  async function generate(id: string) {
    await supabase.functions.invoke("generate-posts", { body: { postIds: [id] } });
    void load();
  }

  async function copy(post: TodayPost) {
    await navigator.clipboard.writeText(post.body);
    setCopiedId(post.id);
    setTimeout(() => setCopiedId(null), 1500);
  }

  async function copyArticle(a: Article) {
    await navigator.clipboard.writeText(a.body);
    setCopiedId(a.id);
    setTimeout(() => setCopiedId(null), 1500);
  }

  async function markArticlePosted(id: string) {
    await supabase
      .from("articles")
      .update({ status: "posted", posted_at: new Date().toISOString() })
      .eq("id", id);
    void load();
  }

  const startMs = startOfToday().getTime();
  // Hide posts belonging to deselected accounts (e.g. accounts we no longer
  // post for). Posts with no account stay visible — they match no toggle.
  const visiblePosts = posts.filter((p) => {
    const name = p.campaigns?.accounts?.display_name;
    return !name || !hidden.has(name);
  });
  const overdue = visiblePosts.filter((p) => new Date(p.scheduled_at).getTime() < startMs);
  const todays = visiblePosts.filter((p) => new Date(p.scheduled_at).getTime() >= startMs);
  const ready = todays.filter((p) => p.body);
  const needsContent = todays.filter((p) => !p.body);

  function readyCard(p: TodayPost, showDate = false) {
    return (
      <div className="card stack" key={p.id}>
        <div className="row between">
          <div>
            <strong>{p.campaigns?.accounts?.display_name ?? "—"}</strong>
            <span className="muted"> · {p.theme}</span>
          </div>
          <div className="row" style={{ gap: 8 }}>
            {showDate && (
              <span className="badge time">
                {new Date(p.scheduled_at).toLocaleDateString()}
              </span>
            )}
            <span className={`badge ${p.status}`}>{p.status}</span>
          </div>
        </div>
        <p style={{ whiteSpace: "pre-wrap", margin: 0 }}>{p.body}</p>
        {p.image_url &&
          (isRenderableImage(p.image_url) ? (
            <div className="stack" style={{ gap: 4 }}>
              <img className="img-preview" src={p.image_url} alt="" loading="lazy" />
              <span className="muted" style={{ fontSize: 13 }}>
                Attach this image manually on LinkedIn —{" "}
                <a href={p.image_url} target="_blank">open full size</a>
              </span>
            </div>
          ) : (
            <div className="muted" style={{ fontSize: 13 }}>
              Image (attach manually):{" "}
              <a href={p.image_url} target="_blank">{p.image_url}</a>
            </div>
          ))}
        <div className="row" style={{ gap: 8 }}>
          <button className={copiedId === p.id ? "copied" : ""} onClick={() => void copy(p)}>
            {copiedId === p.id ? "✓ Copied!" : "Copy"}
          </button>
          <button onClick={() => setSelected({ id: p.id, write: false })}>Open</button>
          <button className="primary" onClick={() => void markPosted(p.id)}>
            Posted
          </button>
        </div>
      </div>
    );
  }

  function needsContentRow(p: TodayPost, showDate = false) {
    return (
      <div className="card row between" key={p.id}>
        <div>
          <strong>{p.campaigns?.accounts?.display_name ?? "—"}</strong>
          <span className="muted"> · {p.theme}</span>
        </div>
        <div className="row" style={{ gap: 8 }}>
          {showDate && (
            <span className="badge time">
              {new Date(p.scheduled_at).toLocaleDateString()}
            </span>
          )}
          <button
            className="primary"
            onClick={() => setSelected({ id: p.id, write: true })}
          >
            Write
          </button>
          <button onClick={() => void generate(p.id)}>✨ Generate</button>
        </div>
      </div>
    );
  }

  function articleCard(a: Article) {
    const overdueArticle = new Date(a.scheduled_at!).getTime() < startMs;
    return (
      <div className="card stack" key={a.id}>
        <div className="row between">
          <div>
            <strong>📄 {a.title}</strong>
            <span className="muted"> · Framer article</span>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <span className={`badge time${overdueArticle ? " overdue" : ""}`}>
              {new Date(a.scheduled_at!).toLocaleString(undefined, {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
            <span className="badge scheduled">scheduled</span>
          </div>
        </div>
        {a.image_url && isRenderableImage(a.image_url) && (
          <img className="img-preview" src={a.image_url} alt="" loading="lazy" />
        )}
        <div className="row" style={{ gap: 8 }}>
          <button
            className={copiedId === a.id ? "copied" : ""}
            onClick={() => void copyArticle(a)}
          >
            {copiedId === a.id ? "✓ Copied!" : "Copy for Framer"}
          </button>
          <button onClick={() => navigate(`/articles/${a.id}`)}>Open</button>
          <button className="primary" onClick={() => void markArticlePosted(a.id)}>
            Posted
          </button>
        </div>
      </div>
    );
  }

  if (loading)
    return (
      <div>
        <h2>Today</h2>
        <div className="loading-row"><span className="spinner" /> Loading…</div>
      </div>
    );

  return (
    <div>
      <h2>Today</h2>

      {accounts.length > 0 && (
        <div className="acct-filter">
          {accounts.map((name) => {
            const on = !hidden.has(name);
            return (
              <button
                key={name}
                className={`weekday-toggle${on ? " on" : ""}`}
                aria-pressed={on}
                onClick={() => toggleAccount(name)}
              >
                {name}
              </button>
            );
          })}
        </div>
      )}

      {overdue.length > 0 && (
        <>
          <div className="section-title overdue-title">Overdue ({overdue.length})</div>
          <div className="stack">
            {overdue.map((p) => (p.body ? readyCard(p, true) : needsContentRow(p, true)))}
          </div>
        </>
      )}

      <div className="section-title">Ready to post ({ready.length})</div>
      {ready.length === 0 ? (
        <div className="empty">Nothing scheduled with a body for today.</div>
      ) : (
        <div className="stack">{ready.map((p) => readyCard(p))}</div>
      )}

      <div className="section-title">Needs content ({needsContent.length})</div>
      {needsContent.length === 0 ? (
        <div className="empty">No empty posts scheduled for today.</div>
      ) : (
        <div className="stack">{needsContent.map((p) => needsContentRow(p))}</div>
      )}

      <div className="section-title">Articles to post ({articles.length})</div>
      {articles.length === 0 ? (
        <div className="empty">No articles scheduled for today.</div>
      ) : (
        <div className="stack">{articles.map((a) => articleCard(a))}</div>
      )}

      {selected && (
        <PostDetailModal
          postId={selected.id}
          initialEditing={selected.write}
          onClose={() => setSelected(null)}
          onChanged={load}
        />
      )}
    </div>
  );
}
