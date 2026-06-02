import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import PostDetailModal from "../components/PostDetailModal";

interface CalPost {
  id: string;
  theme: string;
  status: string;
  scheduled_at: string;
  campaign_id: string;
  campaigns: { accounts: { display_name: string } | null } | null;
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function startOfMonth(y: number, m: number) {
  return new Date(y, m, 1);
}
// Monday-based grid start for the cell containing the 1st.
function gridStart(y: number, m: number) {
  const first = startOfMonth(y, m);
  const day = (first.getDay() + 6) % 7; // 0 = Monday
  const d = new Date(first);
  d.setDate(first.getDate() - day);
  d.setHours(0, 0, 0, 0);
  return d;
}
function sameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
function ymd(d: Date) {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

export default function Calendar() {
  const today = new Date();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [posts, setPosts] = useState<CalPost[]>([]);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);

  const days = useMemo(() => {
    const start = gridStart(year, month);
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
  }, [year, month]);

  async function load() {
    const start = days[0];
    const end = new Date(days[41]);
    end.setDate(end.getDate() + 1);
    const { data } = await supabase
      .from("posts")
      .select("id, theme, status, scheduled_at, campaign_id, campaigns(accounts(display_name))")
      .gte("scheduled_at", start.toISOString())
      .lt("scheduled_at", end.toISOString())
      .order("scheduled_at", { ascending: true });
    if (data) setPosts(data as unknown as CalPost[]);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, month]);

  function prevMonth() {
    const d = new Date(year, month - 1, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth());
  }
  function nextMonth() {
    const d = new Date(year, month + 1, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth());
  }
  function goToday() {
    setYear(today.getFullYear());
    setMonth(today.getMonth());
  }

  // Drop a post onto a day → keep its time-of-day, change the date.
  async function rescheduleTo(postId: string, day: Date) {
    const post = posts.find((p) => p.id === postId);
    if (!post) return;
    const orig = new Date(post.scheduled_at);
    const next = new Date(day);
    next.setHours(orig.getHours(), orig.getMinutes(), 0, 0);
    setPosts((prev) =>
      prev.map((p) => (p.id === postId ? { ...p, scheduled_at: next.toISOString() } : p)),
    );
    await supabase
      .from("posts")
      .update({ scheduled_at: next.toISOString() })
      .eq("id", postId);
  }

  const monthLabel = new Date(year, month, 1).toLocaleString(undefined, {
    month: "long",
    year: "numeric",
  });

  return (
    <div>
      <div className="row between" style={{ flexWrap: "wrap", gap: 10 }}>
        <h2 style={{ margin: 0 }}>Calendar</h2>
        <div className="row" style={{ gap: 8 }}>
          <button onClick={prevMonth}>←</button>
          <button onClick={goToday}>Today</button>
          <button onClick={nextMonth}>→</button>
          <span style={{ marginLeft: 8, fontWeight: 600 }}>{monthLabel}</span>
        </div>
      </div>

      <div className="cal-weekdays">
        {WEEKDAYS.map((w) => (
          <div key={w} className="cal-weekday">{w}</div>
        ))}
      </div>

      <div className="cal-grid">
        {days.map((d) => {
          const key = ymd(d);
          const dayPosts = posts.filter((p) => sameDay(new Date(p.scheduled_at), d));
          const muted = d.getMonth() !== month;
          return (
            <div
              key={key}
              className={`cal-cell${muted ? " muted-month" : ""}${
                sameDay(d, today) ? " is-today" : ""
              }${overKey === key ? " drop-over" : ""}`}
              onDragOver={(e) => {
                if (!dragId) return;
                e.preventDefault();
                setOverKey(key);
              }}
              onDragLeave={() => setOverKey((k) => (k === key ? null : k))}
              onDrop={(e) => {
                e.preventDefault();
                if (dragId) void rescheduleTo(dragId, d);
                setDragId(null);
                setOverKey(null);
              }}
            >
              <div className="cal-date-row">
                <span className="cal-date">{d.getDate()}</span>
                {dayPosts.length > 0 && (
                  <span className="cal-count">{dayPosts.length}</span>
                )}
              </div>
              <div className="cal-chips">
                {dayPosts.map((p) => (
                  <div
                    key={p.id}
                    className={`cal-chip ${p.status}`}
                    draggable
                    onDragStart={() => setDragId(p.id)}
                    onDragEnd={() => setDragId(null)}
                    onClick={() => setSelectedId(p.id)}
                    title={`${p.campaigns?.accounts?.display_name ?? ""} · ${p.theme}`}
                  >
                    {p.theme}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <p className="muted" style={{ fontSize: 13 }}>
        Drag a post to another day to reschedule it (keeps its time of day).
        Click a post to open it.
      </p>

      {selectedId && (
        <PostDetailModal
          postId={selectedId}
          onClose={() => setSelectedId(null)}
          onChanged={load}
        />
      )}
    </div>
  );
}
