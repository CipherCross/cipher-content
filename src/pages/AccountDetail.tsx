import { useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import type { Account, Campaign } from "../lib/types";

export default function AccountDetail() {
  const { accountId } = useParams();
  const [account, setAccount] = useState<Account | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const [acc, camps] = await Promise.all([
      supabase.from("accounts").select("*").eq("id", accountId).single(),
      supabase
        .from("campaigns")
        .select("*")
        .eq("account_id", accountId)
        .order("created_at", { ascending: true }),
    ]);
    if (acc.data) setAccount(acc.data as Account);
    if (camps.data) setCampaigns(camps.data as Campaign[]);
  }

  useEffect(() => {
    void load();
  }, [accountId]);

  async function addCampaign(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const { error } = await supabase.from("campaigns").insert({
      account_id: accountId,
      title,
      description,
    });
    if (error) {
      setError(error.message);
      return;
    }
    setTitle("");
    setDescription("");
    void load();
  }

  async function deleteAccount() {
    if (
      !confirm(
        "Delete this account? This will permanently remove ALL its campaigns and posts.",
      )
    )
      return;
    await supabase.from("accounts").delete().eq("id", accountId);
    window.location.href = "/accounts";
  }

  return (
    <div>
      <p className="muted"><Link to="/accounts">← Accounts</Link></p>
      <div className="row between">
        <h2>{account?.display_name ?? "…"}</h2>
        <button onClick={() => void deleteAccount()}>Delete account</button>
      </div>

      <form className="card stack" onSubmit={addCampaign}>
        <div className="section-title" style={{ marginTop: 0 }}>New campaign</div>
        <input
          placeholder="Title (e.g. Q3 Thought Leadership)"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
        />
        <textarea
          placeholder="Description — purpose, audience, voice. Informs AI tone & context."
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        {error && <div className="error">{error}</div>}
        <div>
          <button className="primary" type="submit">Create campaign</button>
        </div>
      </form>

      <div className="section-title">Campaigns</div>
      {campaigns.length === 0 ? (
        <div className="empty">No campaigns yet.</div>
      ) : (
        <div className="stack">
          {campaigns.map((c) => (
            <div className="card card-link row between" key={c.id}>
              <div>
                <Link to={`/campaigns/${c.id}`}><strong>{c.title}</strong></Link>
                <div className="muted" style={{ fontSize: 13 }}>{c.description}</div>
              </div>
              <span className={`badge ${c.status}`}>{c.status}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
