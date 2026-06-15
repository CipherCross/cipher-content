import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import type { Post, PostStats } from "../lib/types";
import { fromLocalInput, toLocalInput } from "../lib/datetime";
import { isRenderableImage, uploadPostImage } from "../lib/images";
import { formatCount, timeAgo } from "../lib/stats";
import ImagePicker from "./ImagePicker";
import VariationsModal from "./VariationsModal";

interface FullPost extends Post {
  campaigns: { id: string; title: string; accounts: { display_name: string } | null } | null;
  // Latest SDR-reported stats snapshot (limit-1 embed), if any.
  post_stats: Pick<PostStats, "views" | "likes" | "comments" | "recorded_at">[];
}

interface Props {
  postId: string;
  /** Open straight into edit mode (e.g. clicking an empty post to write it). */
  initialEditing?: boolean;
  onClose: () => void;
  onChanged: () => void | Promise<void>;
}

const LINKEDIN_LIMIT = 3000; // LinkedIn hard cap
const HOOK_CHARS = 210; // shown before "…see more" in the feed

export default function PostDetailModal({ postId, initialEditing, onClose, onChanged }: Props) {
  const [post, setPost] = useState<FullPost | null>(null);
  const [editing, setEditing] = useState(initialEditing ?? false);
  const [body, setBody] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [nudge, setNudge] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showVariations, setShowVariations] = useState(false);

  // Refs so the Escape listener (registered once per postId) and backdrop
  // handler always see current state.
  const dirty =
    editing &&
    post !== null &&
    (body !== post.body ||
      imageUrl !== (post.image_url ?? "") ||
      scheduledAt !== toLocalInput(post.scheduled_at));
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;
  const variationsOpenRef = useRef(false);
  variationsOpenRef.current = showVariations;

  async function load() {
    const { data, error } = await supabase
      .from("posts")
      .select(
        "*, campaigns(id, title, accounts(display_name)), post_stats(views, likes, comments, recorded_at)",
      )
      .eq("id", postId)
      .order("recorded_at", { referencedTable: "post_stats", ascending: false })
      .limit(1, { referencedTable: "post_stats" })
      .single();
    if (error) {
      setError(error.message);
      return;
    }
    const p = data as unknown as FullPost;
    setPost(p);
    setBody(p.body);
    setImageUrl(p.image_url ?? "");
    setScheduledAt(toLocalInput(p.scheduled_at));
  }

  function requestClose() {
    if (dirtyRef.current && !confirm("Discard unsaved changes?")) return;
    onClose();
  }

  useEffect(() => {
    void load();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // The variations modal handles its own Escape; don't close both.
      if (variationsOpenRef.current) return;
      requestClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postId]);

  async function refresh() {
    await load();
    await onChanged();
  }

  async function save() {
    setBusy(true);
    setError(null);
    const update: Partial<Post> = {
      body,
      image_url: imageUrl || null,
      scheduled_at: fromLocalInput(scheduledAt),
    };
    // A hand-written body moves the post out of the "pending" pool so bulk
    // AI generation can never overwrite it.
    if (post?.status === "pending" && body.trim()) update.status = "generated";
    const { error } = await supabase.from("posts").update(update).eq("id", postId);
    setBusy(false);
    if (error) return setError(error.message);
    setEditing(false);
    await refresh();
  }

  function cancelEdit() {
    if (dirtyRef.current && !confirm("Discard unsaved changes?")) return;
    if (post) {
      setBody(post.body);
      setImageUrl(post.image_url ?? "");
      setScheduledAt(toLocalInput(post.scheduled_at));
    }
    setEditing(false);
  }

  async function generate(instruction?: string) {
    setBusy(true);
    setError(null);
    try {
      const { error } = await supabase.functions.invoke("generate-posts", {
        body: { postIds: [postId], instruction },
      });
      if (error) throw error;
      setNudge("");
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function approve() {
    await supabase.from("posts").update({ status: "approved" }).eq("id", postId);
    await refresh();
  }

  async function markPosted() {
    await supabase
      .from("posts")
      .update({ status: "posted", posted_at: new Date().toISOString() })
      .eq("id", postId);
    await refresh();
  }

  async function copy() {
    await navigator.clipboard.writeText(post?.body ?? "");
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function useVariation(newBody: string) {
    await supabase
      .from("posts")
      .update({ body: newBody, status: "generated" })
      .eq("id", postId);
    await refresh();
  }

  const firstLine = body.split("\n")[0] ?? "";

  return (
    <div className="modal-backdrop" onMouseDown={requestClose}>
      <div className="modal modal-detail" onMouseDown={(e) => e.stopPropagation()}>
        {!post ? (
          <div className="modal-scroll">
            <div className="loading-row"><span className="spinner" /> Loading…</div>
          </div>
        ) : (
          <>
            <div className="modal-scroll stack" style={{ gap: 14 }}>
              <div className="row between">
                <div>
                  <div className="muted" style={{ fontSize: 13 }}>
                    {post.campaigns?.accounts?.display_name ?? "—"}
                    {post.campaigns && (
                      <>
                        {" · "}
                        <Link to={`/campaigns/${post.campaigns.id}`} onClick={onClose}>
                          {post.campaigns.title}
                        </Link>
                      </>
                    )}
                  </div>
                  <h3 style={{ margin: "4px 0 0" }}>{post.theme}</h3>
                </div>
                <button onClick={requestClose} aria-label="Close">✕</button>
              </div>

              <div className="row" style={{ gap: 8 }}>
                <span className={`badge ${post.status}`}>{post.status}</span>
                {post.scheduled_at && (
                  <span className="badge time">
                    {new Date(post.scheduled_at).toLocaleString()}
                  </span>
                )}
                {!editing && post.body && (
                  <span className="badge time">{post.body.length} chars</span>
                )}
              </div>

              {post.status === "posted" && (
                <div className="muted" style={{ fontSize: 13 }}>
                  {post.post_stats?.[0] ? (
                    <>
                      Performance: 👁 {formatCount(post.post_stats[0].views)} · 👍{" "}
                      {formatCount(post.post_stats[0].likes)} · 💬{" "}
                      {formatCount(post.post_stats[0].comments)} · updated{" "}
                      {timeAgo(post.post_stats[0].recorded_at)} —{" "}
                    </>
                  ) : (
                    <>No stats reported yet — </>
                  )}
                  <Link to="/stats" onClick={onClose}>update on the Stats page</Link>
                  {post.linkedin_url && (
                    <>
                      {" · "}
                      <a href={post.linkedin_url} target="_blank" rel="noreferrer">
                        open on LinkedIn ↗
                      </a>
                    </>
                  )}
                </div>
              )}

              {editing ? (
                <>
                  <label className="field">
                    <span>Body</span>
                    <textarea
                      className="body-editor"
                      autoFocus
                      value={body}
                      onChange={(e) => setBody(e.target.value)}
                    />
                    <span className="row between" style={{ fontWeight: 400 }}>
                      <span
                        className={`char-counter${firstLine.length > HOOK_CHARS ? " warn" : ""}`}
                      >
                        Hook: {firstLine.length}/{HOOK_CHARS} chars before “…see more”
                      </span>
                      <span
                        className={`char-counter${body.length > LINKEDIN_LIMIT ? " over" : ""}`}
                      >
                        {body.length} / {LINKEDIN_LIMIT}
                      </span>
                    </span>
                  </label>
                  <ImagePicker
                    value={imageUrl}
                    onChange={setImageUrl}
                    upload={(f) => uploadPostImage(postId, f)}
                  />
                  <label className="field">
                    <span>Posting date &amp; time</span>
                    <div className="row" style={{ gap: 8 }}>
                      <input
                        type="datetime-local"
                        value={scheduledAt}
                        onChange={(e) => setScheduledAt(e.target.value)}
                        style={{ width: 240 }}
                      />
                      {scheduledAt && (
                        <button onClick={() => setScheduledAt("")}>Clear</button>
                      )}
                    </div>
                  </label>
                </>
              ) : (
                <>
                  {post.body ? (
                    <p style={{ whiteSpace: "pre-wrap", margin: 0 }}>{post.body}</p>
                  ) : (
                    <p className="muted" style={{ margin: 0 }}>
                      No body yet — write one, or generate with AI.
                    </p>
                  )}
                  {post.image_url &&
                    (isRenderableImage(post.image_url) ? (
                      <img
                        className="img-preview"
                        src={post.image_url}
                        alt="Post image"
                        loading="lazy"
                      />
                    ) : (
                      <div className="muted" style={{ fontSize: 13 }}>
                        Image: <a href={post.image_url} target="_blank">{post.image_url}</a>
                      </div>
                    ))}
                </>
              )}
            </div>

            {/* sticky footer — actions always reachable without scrolling */}
            <div className="modal-footer">
              {error && <div className="error">{error}</div>}

              {editing ? (
                <div className="row" style={{ gap: 8 }}>
                  <button className="primary" disabled={busy} onClick={() => void save()}>
                    {busy ? <><span className="spinner" /> Saving…</> : "Save"}
                  </button>
                  <button onClick={cancelEdit}>Cancel</button>
                </div>
              ) : !post.body ? (
                // Empty post: writing is the primary path; AI is the assist.
                <div className="row wrap" style={{ gap: 8 }}>
                  <button className="primary" onClick={() => setEditing(true)}>
                    Write post
                  </button>
                  <button disabled={busy} onClick={() => void generate()}>
                    {busy ? <><span className="spinner" /> Generating…</> : "✨ Generate with AI"}
                  </button>
                </div>
              ) : (
                <>
                  {/* nudge input doubles as the regenerate control */}
                  <div className="row wrap" style={{ gap: 8 }}>
                    <input
                      placeholder="Tweak instruction (optional), then Regenerate"
                      value={nudge}
                      onChange={(e) => setNudge(e.target.value)}
                      style={{ flex: 1, minWidth: 180 }}
                    />
                    <button
                      disabled={busy}
                      onClick={() => void generate(nudge || undefined)}
                    >
                      {busy ? (
                        <><span className="spinner" /> Generating…</>
                      ) : (
                        "✨ Regenerate"
                      )}
                    </button>
                  </div>

                  <div className="row wrap" style={{ gap: 8 }}>
                    <button onClick={() => void copy()}>
                      {copied ? "Copied!" : "Copy"}
                    </button>
                    <button onClick={() => setShowVariations(true)}>Variations</button>
                    <button onClick={() => setEditing(true)}>Edit</button>
                    {post.status === "generated" && (
                      <button className="primary" onClick={() => void approve()}>
                        Approve
                      </button>
                    )}
                    {post.status !== "posted" && (
                      <button onClick={() => void markPosted()}>Mark posted</button>
                    )}
                  </div>
                </>
              )}
            </div>
          </>
        )}

        {showVariations && post && (
          <VariationsModal
            postId={post.id}
            onClose={() => setShowVariations(false)}
            onPicked={useVariation}
          />
        )}
      </div>
    </div>
  );
}
