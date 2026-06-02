import { useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import type { Campaign, Post } from "../lib/types";
import { computeSchedule, type Cadence } from "../lib/schedule";
import PostDetailModal from "../components/PostDetailModal";
import ThemeGeneratorModal from "../components/ThemeGeneratorModal";
import CampaignSettings from "../components/CampaignSettings";

export default function CampaignDetail() {
  const { campaignId } = useParams();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [theme, setTheme] = useState("");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showThemeModal, setShowThemeModal] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // bulk-assign form
  const [startDate, setStartDate] = useState("");
  const [cadenceKind, setCadenceKind] = useState<Cadence["kind"]>("weekdays");
  const [everyN, setEveryN] = useState(2);
  const [time, setTime] = useState("09:00");
  // weekly cadence: which weekdays are selected (default Mon/Wed/Fri)
  const [weekdays, setWeekdays] = useState<number[]>([1, 3, 5]);

  async function loadPosts() {
    const { data } = await supabase
      .from("posts")
      .select("*")
      .eq("campaign_id", campaignId)
      .order("position", { ascending: true });
    if (data) setPosts(data as Post[]);
  }

  // Reorder the local list as the user drags over rows (live preview).
  function reorderPreview(from: number, to: number) {
    if (from === to) return;
    setPosts((prev) => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
    setDragIndex(to);
  }

  // Persist the new order: write position = array index for any post that moved.
  async function persistOrder() {
    setDragIndex(null);
    await Promise.all(
      posts.map((p, i) =>
        p.position === i
          ? null
          : supabase.from("posts").update({ position: i }).eq("id", p.id),
      ),
    );
    void loadPosts();
  }

  async function load() {
    const c = await supabase
      .from("campaigns")
      .select("*")
      .eq("id", campaignId)
      .single();
    if (c.data) setCampaign(c.data as Campaign);
    await loadPosts();
  }

  useEffect(() => {
    void load();
  }, [campaignId]);

  async function addTheme(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const { error } = await supabase.from("posts").insert({
      campaign_id: campaignId,
      theme,
      position: posts.length,
    });
    if (error) {
      setError(error.message);
      return;
    }
    setTheme("");
    void loadPosts();
  }

  async function generate(postIds: string[], instruction?: string) {
    if (postIds.length === 0) return;
    setGenerating(true);
    setError(null);
    try {
      const { data, error } = await supabase.functions.invoke("generate-posts", {
        body: { postIds, instruction },
      });
      if (error) throw error;
      const failed = (data?.results ?? []).filter((r: { ok: boolean }) => !r.ok);
      if (failed.length) setError(`${failed.length} post(s) failed to generate.`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setGenerating(false);
      void loadPosts();
    }
  }

  async function applyBulkDates() {
    if (!startDate) {
      setError("Pick a start date first.");
      return;
    }
    if (cadenceKind === "weekly" && weekdays.length === 0) {
      setError("Pick at least one weekday.");
      return;
    }
    if (posts.some((p) => p.scheduled_at)) {
      if (!confirm("This overwrites existing scheduled dates in this campaign. Continue?"))
        return;
    }
    const cadence: Cadence =
      cadenceKind === "everyNDays"
        ? { kind: "everyNDays", n: everyN }
        : cadenceKind === "weekly"
          ? { kind: "weekly", weekdays }
          : { kind: cadenceKind };

    const slots = computeSchedule(posts.length, startDate, cadence, time);
    await Promise.all(
      posts.map((p, i) =>
        supabase
          .from("posts")
          .update({ scheduled_at: slots[i].toISOString() })
          .eq("id", p.id),
      ),
    );
    void loadPosts();
  }

  const pendingIds = posts.filter((p) => p.status === "pending").map((p) => p.id);

  return (
    <div>
      <p className="muted">
        {campaign && (
          <Link to={`/accounts/${campaign.account_id}`}>← Back to account</Link>
        )}
      </p>
      <h2>{campaign?.title ?? "…"}</h2>

      {campaign && <CampaignSettings campaign={campaign} onChanged={load} />}

      <form className="card row" onSubmit={addTheme} style={{ gap: 10 }}>
        <input
          placeholder="Add a theme (e.g. Why async-first teams win)"
          value={theme}
          onChange={(e) => setTheme(e.target.value)}
          required
        />
        <button type="submit">Add</button>
        <button
          type="button"
          className="primary"
          style={{ whiteSpace: "nowrap" }}
          onClick={() => setShowThemeModal(true)}
        >
          ✨ Generate themes
        </button>
      </form>

      <div className="card stack">
        <div className="section-title" style={{ marginTop: 0 }}>Bulk-assign dates</div>
        <div className="row" style={{ flexWrap: "wrap", gap: 10 }}>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            style={{ width: 160 }}
          />
          <select
            value={cadenceKind}
            onChange={(e) => setCadenceKind(e.target.value as Cadence["kind"])}
            style={{ width: 180 }}
          >
            <option value="daily">Every day</option>
            <option value="weekdays">Every weekday</option>
            <option value="everyNDays">Every N days</option>
            <option value="weekly">Specific weekdays</option>
          </select>
          {cadenceKind === "everyNDays" && (
            <input
              type="number"
              min={1}
              value={everyN}
              onChange={(e) => setEveryN(Number(e.target.value))}
              style={{ width: 80 }}
            />
          )}
          <input
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            style={{ width: 120 }}
          />
          <button onClick={() => void applyBulkDates()}>Apply</button>
        </div>

        {cadenceKind === "weekly" && (
          <div className="weekday-picker">
            {[
              { d: 1, label: "Mon" },
              { d: 2, label: "Tue" },
              { d: 3, label: "Wed" },
              { d: 4, label: "Thu" },
              { d: 5, label: "Fri" },
              { d: 6, label: "Sat" },
              { d: 0, label: "Sun" },
            ].map(({ d, label }) => (
              <button
                key={d}
                type="button"
                className={`weekday-toggle${weekdays.includes(d) ? " on" : ""}`}
                aria-pressed={weekdays.includes(d)}
                onClick={() =>
                  setWeekdays((prev) =>
                    prev.includes(d)
                      ? prev.filter((x) => x !== d)
                      : [...prev, d].sort((a, b) => a - b),
                  )
                }
              >
                {label}
              </button>
            ))}
          </div>
        )}

        <div className="muted" style={{ fontSize: 13 }}>
          Walks posts in order from the start date. Default time 09:00.
        </div>
      </div>

      <div className="row between">
        <div className="section-title">Posts ({posts.length})</div>
        <button
          className="primary"
          disabled={generating || pendingIds.length === 0}
          onClick={() => void generate(pendingIds)}
        >
          {generating ? (
            <><span className="spinner" /> Generating…</>
          ) : (
            `Generate all pending (${pendingIds.length})`
          )}
        </button>
      </div>

      {error && <div className="error">{error}</div>}

      {posts.length === 0 ? (
        <div className="empty">No posts yet. Add themes above, then generate.</div>
      ) : (
        <div className="stack">
          {posts.map((p, i) => (
            <div
              key={p.id}
              className={`drag-row${dragIndex === i ? " dragging" : ""}`}
              onDragOver={(e) => {
                if (dragIndex === null) return;
                e.preventDefault();
                reorderPreview(dragIndex, i);
              }}
              onDrop={(e) => {
                e.preventDefault();
                void persistOrder();
              }}
            >
              <div
                className="post-row card-link"
                onClick={() => setSelectedId(p.id)}
              >
                <span
                  className="drag-handle"
                  title="Drag to reorder"
                  draggable
                  onClick={(e) => e.stopPropagation()}
                  onDragStart={(e) => {
                    e.stopPropagation();
                    setDragIndex(i);
                  }}
                  onDragEnd={() => void persistOrder()}
                >
                  ⠿
                </span>
                <div className="post-row-main">
                  <div className="post-row-top">
                    <strong className="post-row-theme">{p.theme}</strong>
                    <div className="row" style={{ gap: 6 }}>
                      {p.scheduled_at && (
                        <span className="badge time">
                          {new Date(p.scheduled_at).toLocaleDateString(undefined, {
                            month: "short",
                            day: "numeric",
                          })}
                        </span>
                      )}
                      <span className={`badge ${p.status}`}>{p.status}</span>
                    </div>
                  </div>
                  <p className="post-row-preview">
                    {p.body || "No body yet — click to generate."}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {selectedId && (
        <PostDetailModal
          postId={selectedId}
          onClose={() => setSelectedId(null)}
          onChanged={loadPosts}
        />
      )}

      {showThemeModal && (
        <ThemeGeneratorModal
          campaignId={campaignId!}
          startPosition={posts.length}
          onClose={() => setShowThemeModal(false)}
          onAdded={loadPosts}
        />
      )}
    </div>
  );
}
