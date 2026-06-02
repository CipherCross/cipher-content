import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

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

export default function Today() {
  const [posts, setPosts] = useState<TodayPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);

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
    setLoading(false);
  }

  useEffect(() => {
    void load();
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

  const startMs = startOfToday().getTime();
  const overdue = posts.filter((p) => new Date(p.scheduled_at).getTime() < startMs);
  const todays = posts.filter((p) => new Date(p.scheduled_at).getTime() >= startMs);
  const ready = todays.filter((p) => p.body);
  const needsGen = todays.filter((p) => !p.body);

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
        {p.image_url && (
          <div className="muted" style={{ fontSize: 13 }}>
            Image (attach manually):{" "}
            <a href={p.image_url} target="_blank">{p.image_url}</a>
          </div>
        )}
        <div className="row" style={{ gap: 8 }}>
          <button onClick={() => void copy(p)}>
            {copiedId === p.id ? "Copied!" : "Copy"}
          </button>
          <button className="primary" onClick={() => void markPosted(p.id)}>
            Posted
          </button>
        </div>
      </div>
    );
  }

  function needsGenRow(p: TodayPost, showDate = false) {
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
          <button className="primary" onClick={() => void generate(p.id)}>
            Generate
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

      {overdue.length > 0 && (
        <>
          <div className="section-title overdue-title">Overdue ({overdue.length})</div>
          <div className="stack">
            {overdue.map((p) => (p.body ? readyCard(p, true) : needsGenRow(p, true)))}
          </div>
        </>
      )}

      <div className="section-title">Ready to post ({ready.length})</div>
      {ready.length === 0 ? (
        <div className="empty">Nothing scheduled with a body for today.</div>
      ) : (
        <div className="stack">{ready.map((p) => readyCard(p))}</div>
      )}

      <div className="section-title">Needs generation ({needsGen.length})</div>
      {needsGen.length === 0 ? (
        <div className="empty">No ungenerated posts scheduled for today.</div>
      ) : (
        <div className="stack">{needsGen.map((p) => needsGenRow(p))}</div>
      )}
    </div>
  );
}
