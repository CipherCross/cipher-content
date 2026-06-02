import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

interface Props {
  campaignId: string;
  startPosition: number; // first position for the new posts
  onClose: () => void;
  onAdded: () => void | Promise<void>;
}

const MAX_WEEKS = 24;

export default function ThemeGeneratorModal({
  campaignId,
  startPosition,
  onClose,
  onAdded,
}: Props) {
  const [perWeek, setPerWeek] = useState(2);
  const [weeks, setWeeks] = useState(6);
  const [step, setStep] = useState<"config" | "review">("config");
  const [themes, setThemes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const total = Math.max(1, perWeek) * weeks;

  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const { data, error } = await supabase.functions.invoke("generate-themes", {
        body: { campaignId, count: total },
      });
      if (error) throw error;
      const generated: string[] = data?.themes ?? [];
      if (generated.length === 0) throw new Error("No themes returned. Try again.");
      setThemes(generated);
      setStep("review");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function addThemes() {
    const cleaned = themes.map((t) => t.trim()).filter(Boolean);
    if (cleaned.length === 0) {
      setError("Add at least one theme.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const rows = cleaned.map((theme, i) => ({
        campaign_id: campaignId,
        theme,
        position: startPosition + i,
      }));
      const { error } = await supabase.from("posts").insert(rows);
      if (error) throw error;
      await onAdded();
      onClose();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="row between" style={{ marginBottom: 4 }}>
          <h3 style={{ margin: 0 }}>
            {step === "config" ? "Generate themes" : `Review ${themes.length} themes`}
          </h3>
          <button onClick={onClose} aria-label="Close">✕</button>
        </div>

        {step === "config" ? (
          <div className="stack" style={{ gap: 18 }}>
            <p className="muted" style={{ margin: 0 }}>
              Set your cadence and how long the campaign runs. We'll draft that many
              themes for you to review.
            </p>

            <label className="field">
              <span>Posts per week</span>
              <input
                type="number"
                min={1}
                max={14}
                value={perWeek}
                onChange={(e) => setPerWeek(Math.max(1, Number(e.target.value) || 1))}
                style={{ width: 120 }}
              />
            </label>

            <label className="field">
              <span className="row between">
                <span>Duration</span>
                <span className="week-counter">
                  {weeks} {weeks === 1 ? "week" : "weeks"}
                </span>
              </span>
              <input
                type="range"
                className="slider"
                min={1}
                max={MAX_WEEKS}
                value={weeks}
                onChange={(e) => setWeeks(Number(e.target.value))}
              />
              <div className="row between muted" style={{ fontSize: 12 }}>
                <span>1 week</span>
                <span>{MAX_WEEKS} weeks</span>
              </div>
            </label>

            <div className="total-pill">
              = <strong>{total}</strong> theme{total === 1 ? "" : "s"}
            </div>

            {error && <div className="error">{error}</div>}

            <div className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
              <button onClick={onClose}>Cancel</button>
              <button className="primary" disabled={busy} onClick={() => void generate()}>
                {busy ? <><span className="spinner" /> Generating…</> : `Generate ${total} themes`}
              </button>
            </div>
          </div>
        ) : (
          <div className="stack" style={{ gap: 12 }}>
            <p className="muted" style={{ margin: 0 }}>
              Edit, remove, or keep. Approved themes are added as pending posts.
            </p>

            <div className="theme-list">
              {themes.map((t, i) => (
                <div className="theme-item" key={i} style={{ animationDelay: `${i * 0.02}s` }}>
                  <span className="theme-index">{i + 1}</span>
                  <input
                    value={t}
                    onChange={(e) => {
                      const next = [...themes];
                      next[i] = e.target.value;
                      setThemes(next);
                    }}
                  />
                  <button
                    aria-label="Remove"
                    onClick={() => setThemes(themes.filter((_, idx) => idx !== i))}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>

            {error && <div className="error">{error}</div>}

            <div className="row between">
              <button disabled={busy} onClick={() => void generate()}>
                {busy ? <><span className="spinner" /> …</> : "↻ Regenerate"}
              </button>
              <div className="row" style={{ gap: 8 }}>
                <button onClick={() => setStep("config")}>Back</button>
                <button className="primary" disabled={busy} onClick={() => void addThemes()}>
                  {busy ? <><span className="spinner" /> Adding…</> : `Add ${themes.length} themes`}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
