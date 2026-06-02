import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import type { Post } from "../lib/types";
import { fromLocalInput, toLocalInput } from "../lib/datetime";
import VariationsModal from "./VariationsModal";

interface FullPost extends Post {
  campaigns: { id: string; title: string; accounts: { display_name: string } | null } | null;
}

interface Props {
  postId: string;
  onClose: () => void;
  onChanged: () => void | Promise<void>;
}

export default function PostDetailModal({ postId, onClose, onChanged }: Props) {
  const [post, setPost] = useState<FullPost | null>(null);
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [nudge, setNudge] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showVariations, setShowVariations] = useState(false);

  async function load() {
    const { data, error } = await supabase
      .from("posts")
      .select(
        "*, campaigns(id, title, accounts(display_name))",
      )
      .eq("id", postId)
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

  useEffect(() => {
    void load();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
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
    const { error } = await supabase
      .from("posts")
      .update({
        body,
        image_url: imageUrl || null,
        scheduled_at: fromLocalInput(scheduledAt),
      })
      .eq("id", postId);
    setBusy(false);
    if (error) return setError(error.message);
    setEditing(false);
    await refresh();
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

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
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
                <button onClick={onClose} aria-label="Close">✕</button>
              </div>

              <div className="row" style={{ gap: 8 }}>
                <span className={`badge ${post.status}`}>{post.status}</span>
                {post.scheduled_at && (
                  <span className="badge time">
                    {new Date(post.scheduled_at).toLocaleString()}
                  </span>
                )}
              </div>

              {editing ? (
                <>
                  <label className="field">
                    <span>Body</span>
                    <textarea value={body} onChange={(e) => setBody(e.target.value)} />
                  </label>
                  <label className="field">
                    <span>Image URL (Google Drive, optional)</span>
                    <input value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} />
                  </label>
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
                    <p className="muted" style={{ margin: 0 }}>No body yet — generate one.</p>
                  )}
                  {post.image_url && (
                    <div className="muted" style={{ fontSize: 13 }}>
                      Image: <a href={post.image_url} target="_blank">{post.image_url}</a>
                    </div>
                  )}
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
                  <button onClick={() => setEditing(false)}>Cancel</button>
                </div>
              ) : (
                <>
                  {/* nudge input doubles as generate/regenerate control */}
                  <div className="row wrap" style={{ gap: 8 }}>
                    <input
                      placeholder={
                        post.body
                          ? "Tweak instruction (optional), then Regenerate"
                          : "Extra instruction (optional)"
                      }
                      value={nudge}
                      onChange={(e) => setNudge(e.target.value)}
                      style={{ flex: 1, minWidth: 180 }}
                    />
                    <button
                      className="primary"
                      disabled={busy}
                      onClick={() => void generate(nudge || undefined)}
                    >
                      {busy ? (
                        <><span className="spinner" /> Generating…</>
                      ) : post.body ? (
                        "Regenerate"
                      ) : (
                        "Generate"
                      )}
                    </button>
                  </div>

                  <div className="row wrap" style={{ gap: 8 }}>
                    {post.body && (
                      <button onClick={() => void copy()}>
                        {copied ? "Copied!" : "Copy"}
                      </button>
                    )}
                    {post.body && (
                      <button onClick={() => setShowVariations(true)}>Variations</button>
                    )}
                    <button onClick={() => setEditing(true)}>Edit</button>
                    {post.status === "generated" && (
                      <button className="primary" onClick={() => void approve()}>
                        Approve
                      </button>
                    )}
                    {post.body && post.status !== "posted" && (
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
