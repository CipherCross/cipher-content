import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../context/AuthContext";
import type { Account } from "../lib/types";

export default function Accounts() {
  const { session } = useAuth();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [displayName, setDisplayName] = useState("");
  const [linkedinUrl, setLinkedinUrl] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const { data, error } = await supabase
      .from("accounts")
      .select("*")
      .order("created_at", { ascending: true });
    if (error) setError(error.message);
    else setAccounts(data as Account[]);
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, []);

  async function addAccount(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const { error } = await supabase.from("accounts").insert({
      user_id: session!.user.id,
      platform: "linkedin",
      display_name: displayName,
      linkedin_url: linkedinUrl || null,
    });
    if (error) {
      setError(error.message);
      return;
    }
    setDisplayName("");
    setLinkedinUrl("");
    void load();
  }

  return (
    <div>
      <h2>Accounts</h2>

      <form className="card stack" onSubmit={addAccount}>
        <div className="section-title" style={{ marginTop: 0 }}>Add account</div>
        <input
          placeholder="Display name (e.g. Jane — Founder voice)"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          required
        />
        <input
          placeholder="LinkedIn profile URL (optional)"
          value={linkedinUrl}
          onChange={(e) => setLinkedinUrl(e.target.value)}
        />
        {error && <div className="error">{error}</div>}
        <div>
          <button className="primary" type="submit">Add LinkedIn account</button>
        </div>
      </form>

      {loading ? (
        <div className="loading-row"><span className="spinner" /> Loading…</div>
      ) : accounts.length === 0 ? (
        <div className="empty">No accounts yet. Add one above.</div>
      ) : (
        <div className="stack">
          {accounts.map((a) => (
            <div className="card card-link row between" key={a.id}>
              <div>
                <Link to={`/accounts/${a.id}`}>
                  <strong>{a.display_name}</strong>
                </Link>
                <div className="muted" style={{ fontSize: 13 }}>
                  {a.linkedin_url ?? "linkedin"}
                </div>
              </div>
              <span className="badge">{a.platform}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
