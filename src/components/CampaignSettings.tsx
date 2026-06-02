import { useState } from "react";
import { supabase } from "../lib/supabase";
import type { Campaign } from "../lib/types";

interface Props {
  campaign: Campaign;
  onChanged: () => void | Promise<void>;
}

export default function CampaignSettings({ campaign, onChanged }: Props) {
  const [editing, setEditing] = useState(false);
  const [description, setDescription] = useState(campaign.description);
  const [aiInstructions, setAiInstructions] = useState(campaign.ai_instructions);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    const { error } = await supabase
      .from("campaigns")
      .update({ description, ai_instructions: aiInstructions })
      .eq("id", campaign.id);
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    setEditing(false);
    await onChanged();
  }

  function cancel() {
    setDescription(campaign.description);
    setAiInstructions(campaign.ai_instructions);
    setEditing(false);
  }

  if (editing) {
    return (
      <div className="card stack">
        <div className="section-title" style={{ marginTop: 0 }}>Edit campaign</div>
        <label className="field">
          <span>Description</span>
          <textarea
            value={description}
            placeholder="Purpose, audience, voice."
            onChange={(e) => setDescription(e.target.value)}
            style={{ minHeight: 80 }}
          />
        </label>
        <label className="field">
          <span>AI instructions</span>
          <span className="muted" style={{ fontSize: 13, fontWeight: 400 }}>
            Steer tone &amp; voice of generated posts — e.g. "Punchy, first-person,
            no emojis, one idea per post, end with a question."
          </span>
          <textarea
            value={aiInstructions}
            placeholder="Tone, style, dos &amp; don'ts for the AI…"
            onChange={(e) => setAiInstructions(e.target.value)}
            style={{ minHeight: 100 }}
          />
        </label>
        {error && <div className="error">{error}</div>}
        <div className="row" style={{ gap: 8 }}>
          <button className="primary" disabled={busy} onClick={() => void save()}>
            {busy ? <><span className="spinner" /> Saving…</> : "Save"}
          </button>
          <button onClick={cancel}>Cancel</button>
        </div>
      </div>
    );
  }

  return (
    <div className="card stack">
      <div className="row between">
        <div className="section-title" style={{ margin: 0 }}>Campaign details</div>
        <button onClick={() => setEditing(true)}>Edit</button>
      </div>

      <div>
        <div className="field-label">Description</div>
        {campaign.description ? (
          <p style={{ margin: "4px 0 0", whiteSpace: "pre-wrap" }}>
            {campaign.description}
          </p>
        ) : (
          <p className="muted" style={{ margin: "4px 0 0" }}>No description yet.</p>
        )}
      </div>

      <div>
        <div className="field-label">AI instructions</div>
        {campaign.ai_instructions ? (
          <p style={{ margin: "4px 0 0", whiteSpace: "pre-wrap" }}>
            {campaign.ai_instructions}
          </p>
        ) : (
          <p className="muted" style={{ margin: "4px 0 0" }}>
            None set — generation uses default LinkedIn tone.
          </p>
        )}
      </div>
    </div>
  );
}
