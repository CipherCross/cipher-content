import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

interface Props {
  postId: string;
  onClose: () => void;
  onPicked: (body: string) => void | Promise<void>;
}

export default function VariationsModal({ postId, onClose, onPicked }: Props) {
  const [count, setCount] = useState(3);
  const [instruction, setInstruction] = useState("");
  const [variations, setVariations] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [savingIdx, setSavingIdx] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const { data, error } = await supabase.functions.invoke("generate-variations", {
        body: { postId, count, instruction: instruction || undefined },
      });
      if (error) throw error;
      const v: string[] = data?.variations ?? [];
      if (v.length === 0) throw new Error("No variations returned. Try again.");
      setVariations(v);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function pick(idx: number) {
    setSavingIdx(idx);
    await onPicked(variations[idx]);
    onClose();
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="row between" style={{ marginBottom: 4 }}>
          <h3 style={{ margin: 0 }}>Generate variations</h3>
          <button onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="stack" style={{ gap: 14 }}>
          <div className="row wrap" style={{ gap: 10, alignItems: "flex-end" }}>
            <label className="field" style={{ flex: 1, minWidth: 200 }}>
              <span>Optional instruction</span>
              <input
                placeholder="e.g. punchier, add a stat, more personal"
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
              />
            </label>
            <label className="field" style={{ width: 110 }}>
              <span>How many</span>
              <select value={count} onChange={(e) => setCount(Number(e.target.value))}>
                <option value={2}>2</option>
                <option value={3}>3</option>
                <option value={4}>4</option>
                <option value={5}>5</option>
              </select>
            </label>
            <button className="primary" disabled={busy} onClick={() => void generate()}>
              {busy ? <><span className="spinner" /> Generating…</> : variations.length ? "↻ Regenerate" : "Generate"}
            </button>
          </div>

          {error && <div className="error">{error}</div>}

          {variations.length > 0 && (
            <div className="stack" style={{ gap: 10 }}>
              {variations.map((v, i) => (
                <div
                  className="variation-card"
                  key={i}
                  style={{ animationDelay: `${i * 0.04}s` }}
                >
                  <div className="row between" style={{ marginBottom: 6 }}>
                    <span className="badge">Option {i + 1}</span>
                    <span className="muted" style={{ fontSize: 12 }}>{v.length} chars</span>
                  </div>
                  <p style={{ whiteSpace: "pre-wrap", margin: "0 0 10px" }}>{v}</p>
                  <button
                    className="primary"
                    disabled={savingIdx !== null}
                    onClick={() => void pick(i)}
                  >
                    {savingIdx === i ? <><span className="spinner" /> Saving…</> : "Use this"}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
