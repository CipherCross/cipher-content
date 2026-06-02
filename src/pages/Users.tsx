import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../context/AuthContext";
import type { UserProfile, UserRole } from "../lib/types";

export default function Users() {
  const { session } = useAuth();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<UserRole>("member");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const { data } = await supabase
      .from("users")
      .select("*")
      .order("created_at", { ascending: true });
    if (data) setUsers(data as UserProfile[]);
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, []);

  async function call(body: Record<string, unknown>) {
    const { data, error } = await supabase.functions.invoke("admin-users", { body });
    if (error) {
      // surface the function's JSON error message when present
      const msg = (data as { error?: string })?.error ?? error.message;
      throw new Error(msg);
    }
    if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
  }

  async function createUser(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await call({ action: "create", email, password, role });
      setEmail("");
      setPassword("");
      setRole("member");
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(u: UserProfile) {
    if (!confirm(`Delete ${u.email}? This permanently removes their login.`)) return;
    setError(null);
    try {
      await call({ action: "delete", userId: u.id });
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function toggleRole(u: UserProfile) {
    const next: UserRole = u.role === "admin" ? "member" : "admin";
    setError(null);
    try {
      await call({ action: "setRole", userId: u.id, role: next });
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div>
      <h2>Users</h2>

      <form className="card stack" onSubmit={createUser}>
        <div className="section-title" style={{ marginTop: 0 }}>Create user</div>
        <div className="row wrap" style={{ gap: 10, alignItems: "flex-end" }}>
          <label className="field" style={{ flex: 1, minWidth: 200 }}>
            <span>Email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>
          <label className="field" style={{ flex: 1, minWidth: 160 }}>
            <span>Password</span>
            <input
              type="text"
              placeholder="min 6 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          <label className="field" style={{ width: 130 }}>
            <span>Role</span>
            <select value={role} onChange={(e) => setRole(e.target.value as UserRole)}>
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
          </label>
          <button className="primary" type="submit" disabled={busy}>
            {busy ? <><span className="spinner" /> Creating…</> : "Create user"}
          </button>
        </div>
        {error && <div className="error">{error}</div>}
      </form>

      {loading ? (
        <div className="loading-row"><span className="spinner" /> Loading…</div>
      ) : (
        <div className="stack">
          {users.map((u) => {
            const isSelf = u.id === session?.user.id;
            return (
              <div className="card row between" key={u.id}>
                <div>
                  <strong>{u.email}</strong>
                  {isSelf && <span className="muted" style={{ fontSize: 13 }}> (you)</span>}
                </div>
                <div className="row" style={{ gap: 8 }}>
                  <span className={`badge ${u.role === "admin" ? "active" : ""}`}>
                    {u.role}
                  </span>
                  {!isSelf && (
                    <>
                      <button onClick={() => void toggleRole(u)}>
                        {u.role === "admin" ? "Make member" : "Make admin"}
                      </button>
                      <button onClick={() => void remove(u)}>Delete</button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
