import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import type { Campaign, Post, PostStats } from "../lib/types";
import { computeSchedule, type Cadence } from "../lib/schedule";
import { isRenderableImage } from "../lib/images";
import { formatCount } from "../lib/stats";
import PostDetailModal from "../components/PostDetailModal";
import ThemeGeneratorModal from "../components/ThemeGeneratorModal";
import CampaignSettings from "../components/CampaignSettings";

// Post plus its latest SDR-reported stats snapshot (limit-1 embed).
type PostWithStats = Post & {
  post_stats?: Pick<PostStats, "views" | "likes" | "comments" | "recorded_at">[];
};

export default function CampaignDetail() {
  const { campaignId } = useParams();
  const navigate = useNavigate();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [posts, setPosts] = useState<PostWithStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [theme, setTheme] = useState("");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showThemeModal, setShowThemeModal] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedWrite, setSelectedWrite] = useState(false);

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
      .select("*, post_stats(views, likes, comments, recorded_at)")
      .eq("campaign_id", campaignId)
      .order("position", { ascending: true })
      .order("recorded_at", { referencedTable: "post_stats", ascending: false })
      .limit(1, { referencedTable: "post_stats" });
    if (data) setPosts(data as unknown as PostWithStats[]);
    setLoading(false);
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

  async function deletePost(id: string) {
    if (!confirm("Delete this post?")) return;
    await supabase.from("posts").delete().eq("id", id);
    void loadPosts();
  }

  async function deleteCampaign() {
    if (
      !confirm("Delete this campaign? This permanently removes ALL its posts.")
    )
      return;
    await supabase.from("campaigns").delete().eq("id", campaignId);
    navigate(`/accounts/${campaign?.account_id ?? ""}`);
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

  function buildCadence(): Cadence {
    return cadenceKind === "everyNDays"
      ? { kind: "everyNDays", n: everyN }
      : cadenceKind === "weekly"
        ? { kind: "weekly", weekdays }
        : { kind: cadenceKind };
  }

  // Live preview of what "Apply" would write, so dates are never assigned blind.
  const previewSlots = useMemo(() => {
    if (!startDate || posts.length === 0) return null;
    if (cadenceKind === "weekly" && weekdays.length === 0) return null;
    return computeSchedule(posts.length, startDate, buildCadence(), time);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startDate, cadenceKind, everyN, weekdays, time, posts.length]);

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
    const slots = computeSchedule(posts.length, startDate, buildCadence(), time);
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

  // Only empty pending posts are eligible for bulk AI generation — anything
  // with a body (hand-written or generated) must never be overwritten here.
  const emptyPendingIds = posts
    .filter((p) => p.status === "pending" && !p.body.trim())
    .map((p) => p.id);

  const counts = useMemo(() => {
    const written = posts.filter((p) => p.body.trim()).length;
    // Sum the latest stats snapshot of each post for campaign totals.
    const totals = posts.reduce(
      (acc, p) => {
        const s = p.post_stats?.[0];
        if (!s) return acc;
        return {
          reported: true,
          views: acc.views + s.views,
          likes: acc.likes + s.likes,
          comments: acc.comments + s.comments,
        };
      },
      { reported: false, views: 0, likes: 0, comments: 0 },
    );
    return {
      totals,
      total: posts.length,
      unwritten: posts.length - written,
      awaitingApproval: posts.filter((p) => p.status === "generated").length,
      approved: posts.filter((p) => p.status === "approved").length,
      posted: posts.filter((p) => p.status === "posted").length,
      scheduled: posts.filter((p) => p.scheduled_at).length,
    };
  }, [posts]);

  const nextHint =
    counts.total === 0
      ? "Next: add themes below — one per post — or use ✨ Generate themes for ideas."
      : counts.unwritten > 0
        ? `Next: write the ${counts.unwritten} empty post${counts.unwritten === 1 ? "" : "s"} (click a post, then “Write post”) — or generate them with AI.`
        : counts.scheduled < counts.total
          ? "Next: assign posting dates below so posts show up on the Today page."
          : counts.awaitingApproval > 0
            ? `Next: review and approve the ${counts.awaitingApproval} post${counts.awaitingApproval === 1 ? "" : "s"} awaiting approval.`
            : "All set — check the Today page each morning for what to post.";

  function openPost(p: Post) {
    setSelectedWrite(!p.body); // empty posts open straight into writing
    setSelectedId(p.id);
  }

  return (
    <div>
      <p className="muted">
        {campaign && (
          <Link to={`/accounts/${campaign.account_id}`}>← Back to account</Link>
        )}
      </p>
      <div className="row between">
        <h2>{campaign?.title ?? "…"}</h2>
        {campaign && (
          <button style={{ color: "var(--red)" }} onClick={() => void deleteCampaign()}>
            Delete campaign
          </button>
        )}
      </div>

      {counts.total > 0 && (
        <div className="stats-strip">
          <span className="badge">{counts.total} post{counts.total === 1 ? "" : "s"}</span>
          {counts.unwritten > 0 && (
            <span className="badge pending">{counts.unwritten} unwritten</span>
          )}
          {counts.awaitingApproval > 0 && (
            <span className="badge generated">{counts.awaitingApproval} to approve</span>
          )}
          {counts.approved > 0 && (
            <span className="badge approved">{counts.approved} approved</span>
          )}
          {counts.posted > 0 && (
            <span className="badge posted">{counts.posted} posted</span>
          )}
          <span className="badge time">{counts.scheduled} scheduled</span>
          {counts.totals.reported && (
            <span className="badge">
              👁 {formatCount(counts.totals.views)} · 👍 {formatCount(counts.totals.likes)} · 💬 {formatCount(counts.totals.comments)}
            </span>
          )}
        </div>
      )}
      <div className="next-hint">{nextHint}</div>

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
          <button disabled={!previewSlots} onClick={() => void applyBulkDates()}>
            Apply these dates
          </button>
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

        {previewSlots ? (
          <div className="schedule-preview">
            {previewSlots.slice(0, 5).map((d, i) => (
              <div key={i}>
                Post {i + 1}:{" "}
                {d.toLocaleString(undefined, {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </div>
            ))}
            {previewSlots.length > 5 && (
              <div>
                … and {previewSlots.length - 5} more, ending{" "}
                {previewSlots[previewSlots.length - 1].toLocaleDateString(undefined, {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                })}
              </div>
            )}
          </div>
        ) : (
          <div className="muted" style={{ fontSize: 13 }}>
            Pick a start date to preview the dates before applying.
          </div>
        )}
      </div>

      <div className="row between">
        <div className="section-title">Posts ({posts.length})</div>
        <button
          disabled={generating || emptyPendingIds.length === 0}
          onClick={() => void generate(emptyPendingIds)}
        >
          {generating ? (
            <><span className="spinner" /> Generating…</>
          ) : (
            `✨ Generate ${emptyPendingIds.length} empty post${emptyPendingIds.length === 1 ? "" : "s"} with AI`
          )}
        </button>
      </div>

      {error && <div className="error">{error}</div>}

      {loading ? (
        <div className="stack">
          <div className="skeleton-row" />
          <div className="skeleton-row" />
          <div className="skeleton-row" />
        </div>
      ) : posts.length === 0 ? (
        <div className="empty">{nextHint}</div>
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
                onClick={() => openPost(p)}
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
                {isRenderableImage(p.image_url) && (
                  <img className="img-thumb" src={p.image_url} alt="" loading="lazy" />
                )}
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
                      <button
                        style={{ color: "var(--red)" }}
                        onClick={(e) => {
                          e.stopPropagation();
                          void deletePost(p.id);
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                  <p className="post-row-preview">
                    {p.body || "No body yet — click to write."}
                  </p>
                  {p.status === "posted" && p.post_stats?.[0] && (
                    <div className="stat-chips">
                      👁 {formatCount(p.post_stats[0].views)} · 👍{" "}
                      {formatCount(p.post_stats[0].likes)} · 💬{" "}
                      {formatCount(p.post_stats[0].comments)}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {selectedId && (
        <PostDetailModal
          postId={selectedId}
          initialEditing={selectedWrite}
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
