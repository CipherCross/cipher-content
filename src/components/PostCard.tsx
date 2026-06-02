import { useState } from "react";
import { supabase } from "../lib/supabase";
import type { Post } from "../lib/types";
import { fromLocalInput, toLocalInput } from "../lib/datetime";
import VariationsModal from "./VariationsModal";

interface Props {
  post: Post;
  onChanged: () => void | Promise<void>;
  onGenerate: (instruction?: string) => void | Promise<void>;
  generating: boolean;
  dragHandle?: React.ReactNode;
}

export default function PostCard({
  post,
  onChanged,
  onGenerate,
  generating,
  dragHandle,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(post.body);
  const [imageUrl, setImageUrl] = useState(post.image_url ?? "");
  const [scheduledAt, setScheduledAt] = useState(toLocalInput(post.scheduled_at));
  const [nudgeOpen, setNudgeOpen] = useState(false);
  const [nudge, setNudge] = useState("");
  const [showVariations, setShowVariations] = useState(false);

  async function useVariation(newBody: string) {
    await supabase
      .from("posts")
      .update({ body: newBody, status: "generated" })
      .eq("id", post.id);
    await onChanged();
  }

  async function save() {
    await supabase
      .from("posts")
      .update({
        body,
        image_url: imageUrl || null,
        scheduled_at: fromLocalInput(scheduledAt),
      })
      .eq("id", post.id);
    setEditing(false);
    await onChanged();
  }

  async function approve() {
    await supabase.from("posts").update({ status: "approved" }).eq("id", post.id);
    await onChanged();
  }

  async function remove() {
    if (!confirm("Delete this post?")) return;
    await supabase.from("posts").delete().eq("id", post.id);
    await onChanged();
  }

  return (
    <div className="card stack">
      <div className="row between">
        <div className="row" style={{ gap: 8 }}>
          {dragHandle}
          <strong>{post.theme}</strong>
        </div>
        <div className="row" style={{ gap: 8 }}>
          {post.scheduled_at && (
            <span className="badge time">
              {new Date(post.scheduled_at).toLocaleString()}
            </span>
          )}
          <span className={`badge ${post.status}`}>{post.status}</span>
        </div>
      </div>

      {editing ? (
        <>
          <textarea value={body} onChange={(e) => setBody(e.target.value)} />
          <input
            placeholder="Image URL (Google Drive, optional)"
            value={imageUrl}
            onChange={(e) => setImageUrl(e.target.value)}
          />
          <label className="muted" style={{ fontSize: 13 }}>
            Posting date &amp; time
            <div className="row" style={{ gap: 8, marginTop: 6 }}>
              <input
                type="datetime-local"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
                style={{ width: 240 }}
              />
              {scheduledAt && (
                <button type="button" onClick={() => setScheduledAt("")}>
                  Clear
                </button>
              )}
            </div>
          </label>
          <div className="row" style={{ gap: 8 }}>
            <button className="primary" onClick={() => void save()}>Save</button>
            <button
              onClick={() => {
                setBody(post.body);
                setImageUrl(post.image_url ?? "");
                setScheduledAt(toLocalInput(post.scheduled_at));
                setEditing(false);
              }}
            >
              Cancel
            </button>
          </div>
        </>
      ) : (
        <>
          {post.body ? (
            <p style={{ whiteSpace: "pre-wrap", margin: 0 }}>{post.body}</p>
          ) : (
            <p className="muted" style={{ margin: 0 }}>No body yet.</p>
          )}
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            {post.status === "pending" ? (
              <button
                className="primary"
                disabled={generating}
                onClick={() => void onGenerate()}
              >
                {generating ? <><span className="spinner" /> Generating…</> : "Generate"}
              </button>
            ) : (
              <button
                disabled={generating}
                onClick={() => setNudgeOpen((v) => !v)}
              >
                {generating ? <><span className="spinner" /> Generating…</> : "Regenerate"}
              </button>
            )}
            {post.body && (
              <button onClick={() => setShowVariations(true)}>Variations</button>
            )}
            <button onClick={() => setEditing(true)}>Edit</button>
            {post.status === "generated" && (
              <button className="primary" onClick={() => void approve()}>Approve</button>
            )}
            <button onClick={() => void remove()}>Delete</button>
          </div>

          {nudgeOpen && (
            <div className="nudge-panel">
              <input
                autoFocus
                placeholder="What should change? (optional) e.g. shorter, add a stat"
                value={nudge}
                onChange={(e) => setNudge(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    setNudgeOpen(false);
                    void onGenerate(nudge || undefined);
                    setNudge("");
                  }
                }}
              />
              <button
                className="primary"
                disabled={generating}
                onClick={() => {
                  setNudgeOpen(false);
                  void onGenerate(nudge || undefined);
                  setNudge("");
                }}
              >
                Regenerate
              </button>
              <button onClick={() => setNudgeOpen(false)}>Cancel</button>
            </div>
          )}
        </>
      )}

      {showVariations && (
        <VariationsModal
          postId={post.id}
          onClose={() => setShowVariations(false)}
          onPicked={useVariation}
        />
      )}
    </div>
  );
}
