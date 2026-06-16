import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import type { Article } from "../lib/types";
import { isRenderableImage } from "../lib/images";

export default function Articles() {
  const navigate = useNavigate();
  const [articles, setArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const { data } = await supabase
      .from("articles")
      .select("*")
      .order("updated_at", { ascending: false });
    if (data) setArticles(data as Article[]);
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, []);

  // Creating an article with just a title makes it a draft (DB default) and
  // drops the writer straight into the editor.
  async function create(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setCreating(true);
    setError(null);
    const { data, error } = await supabase
      .from("articles")
      .insert({ title: title.trim() })
      .select("id")
      .single();
    setCreating(false);
    if (error) {
      setError(error.message);
      return;
    }
    navigate(`/articles/${data.id}`);
  }

  async function remove(id: string) {
    if (!confirm("Delete this article permanently? This cannot be undone.")) return;
    await supabase.from("articles").delete().eq("id", id);
    void load();
  }

  const scheduled = articles
    .filter((a) => a.status === "scheduled")
    .sort((a, b) => (a.scheduled_at ?? "").localeCompare(b.scheduled_at ?? ""));
  const drafts = articles.filter((a) => a.status === "draft");
  const posted = articles.filter((a) => a.status === "posted");

  function card(a: Article) {
    const when =
      a.status === "scheduled" && a.scheduled_at
        ? `Scheduled for ${new Date(a.scheduled_at).toLocaleString(undefined, {
            weekday: "short",
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })}`
        : a.status === "posted" && a.posted_at
          ? `Posted ${new Date(a.posted_at).toLocaleDateString()}`
          : `Edited ${new Date(a.updated_at).toLocaleDateString()}`;
    return (
      <div
        className="card card-link post-row"
        key={a.id}
        onClick={() => navigate(`/articles/${a.id}`)}
      >
        {isRenderableImage(a.image_url) && (
          <img className="img-thumb" src={a.image_url} alt="" loading="lazy" />
        )}
        <div className="post-row-main">
          <div className="post-row-top">
            <strong className="post-row-theme">{a.title}</strong>
            <div className="row" style={{ gap: 6 }}>
              <span className={`badge ${a.status}`}>{a.status}</span>
              <button
                style={{ color: "var(--red)" }}
                onClick={(e) => {
                  e.stopPropagation();
                  void remove(a.id);
                }}
              >
                Delete
              </button>
            </div>
          </div>
          <p className="post-row-preview">{when}</p>
        </div>
      </div>
    );
  }

  function section(label: string, list: Article[], emptyText: string) {
    return (
      <>
        <div className="section-title">
          {label} ({list.length})
        </div>
        {list.length === 0 ? (
          <div className="empty">{emptyText}</div>
        ) : (
          <div className="stack">{list.map(card)}</div>
        )}
      </>
    );
  }

  return (
    <div>
      <h2>Articles</h2>
      <p className="muted" style={{ marginTop: -8 }}>
        Long-form drafts for the Framer site. Write in Markdown, then copy it
        into Framer's CMS.
      </p>

      <form className="card row" onSubmit={create} style={{ gap: 10 }}>
        <input
          placeholder="New article title (e.g. How we cut onboarding time in half)"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
        />
        <button type="submit" className="primary" disabled={creating} style={{ whiteSpace: "nowrap" }}>
          {creating ? <><span className="spinner" /> Creating…</> : "New draft"}
        </button>
      </form>

      {error && <div className="error">{error}</div>}

      {loading ? (
        <div className="stack" style={{ marginTop: 20 }}>
          <div className="skeleton-row" />
          <div className="skeleton-row" />
        </div>
      ) : (
        <>
          {section("Scheduled", scheduled, "No articles scheduled. Open a draft and pick a date to schedule it.")}
          {section("Drafts", drafts, "No drafts yet — create one above.")}
          {section("History", posted, "Nothing posted yet.")}
        </>
      )}
    </div>
  );
}
