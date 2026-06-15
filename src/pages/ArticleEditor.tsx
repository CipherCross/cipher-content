import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import type { Article } from "../lib/types";
import { fromLocalInput, toLocalInput } from "../lib/datetime";
import { uploadArticleImage } from "../lib/images";
import { renderMarkdown } from "../lib/markdown";
import ImagePicker from "../components/ImagePicker";

type SaveState = "idle" | "saving" | "saved" | "error";

export default function ArticleEditor() {
  const { articleId } = useParams();
  const navigate = useNavigate();

  const [article, setArticle] = useState<Article | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [preview, setPreview] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  // Schedule panel
  const [showSchedule, setShowSchedule] = useState(false);
  const [scheduleInput, setScheduleInput] = useState("");

  const bodyRef = useRef<HTMLTextAreaElement>(null);
  // Last-persisted content, to detect what still needs saving.
  const savedRef = useRef({ title: "", body: "", imageUrl: "" });
  // Always-current content, so saveContent() (which can fire from a stale
  // closure on unmount/debounce) never writes outdated values.
  const latest = useRef({ title: "", body: "", imageUrl: "" });
  latest.current = { title, body, imageUrl };

  async function load() {
    const { data, error } = await supabase
      .from("articles")
      .select("*")
      .eq("id", articleId)
      .single();
    if (error) {
      setError(error.message);
      return;
    }
    const a = data as Article;
    setArticle(a);
    setTitle(a.title);
    setBody(a.body);
    setImageUrl(a.image_url ?? "");
    savedRef.current = { title: a.title, body: a.body, imageUrl: a.image_url ?? "" };
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [articleId]);

  // Writes title/body/image. Returns true on success. Shared by the autosave
  // debounce and by the explicit status transitions (which flush first).
  async function saveContent(): Promise<boolean> {
    const { title: t, body: b, imageUrl: img } = latest.current;
    setSaveState("saving");
    const { error } = await supabase
      .from("articles")
      .update({ title: t, body: b, image_url: img || null })
      .eq("id", articleId);
    if (error) {
      setSaveState("error");
      setError(error.message);
      return false;
    }
    savedRef.current = { title: t, body: b, imageUrl: img };
    setSaveState("saved");
    return true;
  }

  const dirty =
    title !== savedRef.current.title ||
    body !== savedRef.current.body ||
    imageUrl !== savedRef.current.imageUrl;

  // Autosave on edit: debounce 800ms after the last keystroke.
  useEffect(() => {
    if (!article || !dirty) return;
    const t = setTimeout(() => void saveContent(), 800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, body, imageUrl, article]);

  // Flush a pending edit if we navigate away before the debounce fires.
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;
  useEffect(() => {
    return () => {
      if (dirtyRef.current) void saveContent();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Markdown toolbar helpers ----------------------------------------
  function surround(before: string, after = before) {
    const ta = bodyRef.current;
    if (!ta) return;
    const s = ta.selectionStart;
    const e = ta.selectionEnd;
    const next = body.slice(0, s) + before + body.slice(s, e) + after + body.slice(e);
    setBody(next);
    requestAnimationFrame(() => {
      ta.focus();
      ta.selectionStart = s + before.length;
      ta.selectionEnd = e + before.length;
    });
  }
  function linePrefix(prefix: string) {
    const ta = bodyRef.current;
    if (!ta) return;
    const s = ta.selectionStart;
    const lineStart = body.lastIndexOf("\n", s - 1) + 1;
    const next = body.slice(0, lineStart) + prefix + body.slice(lineStart);
    setBody(next);
    requestAnimationFrame(() => {
      ta.focus();
      ta.selectionStart = ta.selectionEnd = s + prefix.length;
    });
  }

  // ---- Status transitions ----------------------------------------------
  async function schedule() {
    const iso = fromLocalInput(scheduleInput);
    if (!iso) {
      setError("Pick a date and time first.");
      return;
    }
    setBusy(true);
    setError(null);
    await saveContent();
    const { error } = await supabase
      .from("articles")
      .update({ status: "scheduled", scheduled_at: iso })
      .eq("id", articleId);
    setBusy(false);
    if (error) return setError(error.message);
    setShowSchedule(false);
    await load();
  }

  async function unschedule() {
    setBusy(true);
    await supabase
      .from("articles")
      .update({ status: "draft", scheduled_at: null })
      .eq("id", articleId);
    setBusy(false);
    await load();
  }

  async function markPosted() {
    setBusy(true);
    await saveContent();
    await supabase
      .from("articles")
      .update({ status: "posted", posted_at: new Date().toISOString() })
      .eq("id", articleId);
    setBusy(false);
    await load();
  }

  async function moveToDraft() {
    setBusy(true);
    await supabase
      .from("articles")
      .update({ status: "draft", posted_at: null })
      .eq("id", articleId);
    setBusy(false);
    await load();
  }

  async function remove() {
    if (!confirm("Delete this article permanently? This cannot be undone.")) return;
    await supabase.from("articles").delete().eq("id", articleId);
    navigate("/articles");
  }

  async function copyMarkdown() {
    await navigator.clipboard.writeText(body);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function openSchedule() {
    setScheduleInput(toLocalInput(article?.scheduled_at ?? null));
    setShowSchedule(true);
  }

  if (error && !article) {
    return (
      <div>
        <p className="muted"><Link to="/articles">← Back to articles</Link></p>
        <div className="error">{error}</div>
      </div>
    );
  }

  if (!article) {
    return (
      <div>
        <h2>Article</h2>
        <div className="loading-row"><span className="spinner" /> Loading…</div>
      </div>
    );
  }

  const saveLabel =
    saveState === "saving"
      ? "Saving…"
      : saveState === "error"
        ? "Save failed"
        : dirty
          ? "Unsaved…"
          : "Saved";

  return (
    <div>
      <div className="row between" style={{ marginBottom: 4 }}>
        <p className="muted" style={{ margin: 0 }}>
          <Link to="/articles">← Back to articles</Link>
        </p>
        <div className="row" style={{ gap: 8 }}>
          <span className={`badge ${article.status}`}>{article.status}</span>
          <span
            className={`save-indicator${saveState === "error" ? " err" : ""}${
              !dirty && saveState !== "error" ? " ok" : ""
            }`}
          >
            {saveLabel}
          </span>
        </div>
      </div>

      <input
        className="article-title"
        placeholder="Article title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />

      {/* Schedule status / controls */}
      {article.status === "scheduled" && article.scheduled_at && (
        <div className="next-hint row between" style={{ alignItems: "center" }}>
          <span>
            📅 Scheduled for{" "}
            {new Date(article.scheduled_at).toLocaleString(undefined, {
              weekday: "short",
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}{" "}
            — it'll show on the Today page on the day.
          </span>
          <div className="row" style={{ gap: 8 }}>
            <button onClick={openSchedule} disabled={busy}>Reschedule</button>
            <button onClick={() => void unschedule()} disabled={busy}>Unschedule</button>
          </div>
        </div>
      )}
      {article.status === "posted" && (
        <div className="next-hint row between" style={{ alignItems: "center" }}>
          <span>
            ✅ Posted{article.posted_at ? ` on ${new Date(article.posted_at).toLocaleDateString()}` : ""}.
          </span>
          <button onClick={() => void moveToDraft()} disabled={busy}>Move back to draft</button>
        </div>
      )}

      {/* Markdown toolbar */}
      <div className="md-toolbar">
        <button type="button" title="Heading" onClick={() => linePrefix("## ")}>H2</button>
        <button type="button" title="Subheading" onClick={() => linePrefix("### ")}>H3</button>
        <button type="button" title="Bold" onClick={() => surround("**")}><b>B</b></button>
        <button type="button" title="Italic" onClick={() => surround("_")}><i>I</i></button>
        <button type="button" title="Link" onClick={() => surround("[", "](https://)")}>🔗</button>
        <button type="button" title="Bulleted list" onClick={() => linePrefix("- ")}>• List</button>
        <button type="button" title="Numbered list" onClick={() => linePrefix("1. ")}>1. List</button>
        <button type="button" title="Quote" onClick={() => linePrefix("> ")}>❝</button>
        <button type="button" title="Inline code" onClick={() => surround("`")}>{"</>"}</button>
        <div className="spacer" style={{ flex: 1 }} />
        <button
          type="button"
          className={preview ? "primary" : ""}
          onClick={() => setPreview((p) => !p)}
        >
          {preview ? "Edit" : "Preview"}
        </button>
      </div>

      {preview ? (
        <div
          className="md-preview card"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(body) }}
        />
      ) : (
        <textarea
          ref={bodyRef}
          className="body-editor article-body"
          placeholder="Write your article in Markdown — headings, **bold**, lists, > quotes, [links](url)… Then Preview, or Copy for Framer."
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
      )}

      <div className="card" style={{ marginTop: 14 }}>
        <ImagePicker
          label="Cover image (optional) — upload or paste a Google Drive link"
          value={imageUrl}
          onChange={setImageUrl}
          upload={(f) => uploadArticleImage(article.id, f)}
        />
      </div>

      {error && <div className="error" style={{ marginTop: 12 }}>{error}</div>}

      {/* Schedule panel */}
      {showSchedule && (
        <div className="card stack" style={{ marginTop: 14 }}>
          <div className="field-label">Schedule for posting</div>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <input
              type="datetime-local"
              value={scheduleInput}
              onChange={(e) => setScheduleInput(e.target.value)}
              style={{ width: 240 }}
            />
            <button className="primary" disabled={busy} onClick={() => void schedule()}>
              {busy ? <><span className="spinner" /> Scheduling…</> : "Schedule"}
            </button>
            <button onClick={() => setShowSchedule(false)}>Cancel</button>
          </div>
        </div>
      )}

      {/* Action bar */}
      <div className="row wrap" style={{ gap: 8, marginTop: 18 }}>
        <button onClick={() => void copyMarkdown()}>
          {copied ? "Copied!" : "Copy for Framer"}
        </button>
        {article.status === "draft" && (
          <button className="primary" onClick={openSchedule}>Schedule for posting</button>
        )}
        {article.status !== "posted" && (
          <button onClick={() => void markPosted()} disabled={busy}>Mark posted</button>
        )}
        <div style={{ flex: 1 }} />
        <button onClick={() => void remove()} style={{ color: "var(--red)" }}>Delete</button>
      </div>
    </div>
  );
}
