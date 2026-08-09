import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { authFetch, getUser, isAdmin, type Role, type Status, type User } from "../auth";
import { useTheme } from "../theme";

export function meta() {
  return [{ title: "BFO - Users" }];
}

const ROLE_LABELS: Record<Role, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
  viewer: "Viewer",
};

const ROLE_HINTS: Record<Role, string> = {
  owner: "Full access, manages users and other owners",
  admin: "Full access, can approve and manage users",
  member: "Full access to the office",
  viewer: "Read-only access",
};

function statusStyles(status: Status, isDark: boolean) {
  if (status === "approved")
    return isDark ? "bg-emerald-500/10 text-emerald-400" : "bg-emerald-50 text-emerald-700";
  if (status === "incoming")
    return isDark ? "bg-amber-500/10 text-amber-400" : "bg-amber-50 text-amber-700";
  return isDark ? "bg-red-500/10 text-red-400" : "bg-red-50 text-red-700";
}

function initialsFor(user: User): string {
  const name = user.name?.trim();
  if (name) {
    const parts = name.split(/\s+/);
    return ((parts[0][0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
  }
  if (user.email) return user.email[0].toUpperCase();
  return user.phone?.slice(-2) ?? "?";
}

function contact(user: User): string {
  return [user.phoneFormatted || user.phone, user.email].filter(Boolean).join(" · ") || "—";
}

function since(iso: string | null): string {
  if (!iso) return "Never";
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export default function Users() {
  const navigate = useNavigate();
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const [users, setUsers] = useState<User[]>([]);
  const [me, setMe] = useState<User | null>(getUser());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ name: "", phone: "", email: "", role: "member" as Role });

  useEffect(() => {
    if (!isAdmin()) {
      navigate("/home");
      return;
    }
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function load() {
    setLoading(true);
    try {
      const res = await authFetch("/api/auth/users");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.message ?? "Couldn't load users.");
      setUsers(data.users);
      setMe(data.me);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load users.");
    } finally {
      setLoading(false);
    }
  }

  async function mutate(method: "PATCH" | "DELETE", user: User, patch?: Record<string, unknown>) {
    setBusyId(user.id);
    setError("");
    try {
      const res = await authFetch(
        method === "DELETE" ? `/api/auth/users?id=${user.id}` : "/api/auth/users",
        {
          method,
          ...(method === "PATCH" ? { body: JSON.stringify({ id: user.id, ...patch }) } : {}),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.message ?? "That didn't work.");
      if (method === "DELETE") setUsers((prev) => prev.filter((u) => u.id !== user.id));
      else setUsers((prev) => prev.map((u) => (u.id === user.id ? data.user : u)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't work.");
    } finally {
      setBusyId(null);
    }
  }

  async function addUser(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.phone.trim() && !draft.email.trim()) {
      setError("A phone number or email address is required.");
      return;
    }
    setBusyId("new");
    setError("");
    try {
      const res = await authFetch("/api/auth/users", {
        method: "POST",
        body: JSON.stringify(draft),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.message ?? "Couldn't add that user.");
      setUsers((prev) => [...prev, data.user]);
      setDraft({ name: "", phone: "", email: "", role: "member" });
      setAdding(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't add that user.");
    } finally {
      setBusyId(null);
    }
  }

  const incoming = users.filter((u) => u.status === "incoming");
  const rest = users.filter((u) => u.status !== "incoming");
  const canSetOwner = me?.role === "owner";

  const card = isDark ? "border-white/10 bg-white/[0.02]" : "border-gray-200 bg-white";
  const input = `w-full px-3 py-2 rounded-lg text-sm border transition-colors focus:outline-none ${
    isDark
      ? "bg-white/[0.04] border-white/10 text-white placeholder-gray-600 focus:border-white/25"
      : "bg-white border-gray-200 text-gray-900 placeholder-gray-400 focus:border-gray-400"
  }`;
  const subtle = isDark ? "text-gray-500" : "text-gray-500";

  return (
    <div>
      <div className="flex items-start justify-between gap-4 mb-8">
        <div>
          <h1 className={`text-2xl font-bold ${isDark ? "" : "text-gray-900"}`}>Users</h1>
          <p className={`text-sm mt-1 ${subtle}`}>
            Who can sign in to BFO, and what they can do once they're in
          </p>
        </div>
        <button
          onClick={() => setAdding((v) => !v)}
          className={`shrink-0 px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
            isDark ? "bg-white text-black hover:bg-gray-200" : "bg-gray-900 text-white hover:bg-black"
          }`}
        >
          {adding ? "Cancel" : "Add user"}
        </button>
      </div>

      {error && (
        <div className={`mb-6 rounded-lg px-4 py-3 text-sm ${isDark ? "bg-red-500/10 text-red-400" : "bg-red-50 text-red-700"}`}>
          {error}
        </div>
      )}

      {adding && (
        <form onSubmit={addUser} className={`rounded-xl border p-5 mb-6 ${card}`}>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={`text-xs font-medium uppercase tracking-wider mb-1.5 block ${subtle}`}>Name</label>
              <input className={input} value={draft.name} placeholder="Jane Burton"
                onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </div>
            <div>
              <label className={`text-xs font-medium uppercase tracking-wider mb-1.5 block ${subtle}`}>Role</label>
              <select className={input} value={draft.role}
                onChange={(e) => setDraft({ ...draft, role: e.target.value as Role })}>
                {(["admin", "member", "viewer", ...(canSetOwner ? ["owner"] : [])] as Role[]).map((r) => (
                  <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={`text-xs font-medium uppercase tracking-wider mb-1.5 block ${subtle}`}>Phone</label>
              <input className={input} value={draft.phone} placeholder="(555) 123-4567"
                onChange={(e) => setDraft({ ...draft, phone: e.target.value })} />
            </div>
            <div>
              <label className={`text-xs font-medium uppercase tracking-wider mb-1.5 block ${subtle}`}>Email</label>
              <input className={input} value={draft.email} placeholder="jane@burtonfamilyoffice.com"
                onChange={(e) => setDraft({ ...draft, email: e.target.value })} />
            </div>
          </div>
          <div className="flex items-center gap-3 mt-4">
            <button type="submit" disabled={busyId === "new"}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer disabled:opacity-50 ${
                isDark ? "bg-white text-black hover:bg-gray-200" : "bg-gray-900 text-white hover:bg-black"
              }`}>
              {busyId === "new" ? "Adding…" : "Add user"}
            </button>
            <span className={`text-xs ${subtle}`}>{ROLE_HINTS[draft.role]}</span>
          </div>
        </form>
      )}

      {loading ? (
        <p className={`text-sm ${subtle}`}>Loading…</p>
      ) : (
        <>
          {incoming.length > 0 && (
            <section className={`rounded-xl border p-5 mb-6 ${isDark ? "border-amber-500/20 bg-amber-500/[0.04]" : "border-amber-200 bg-amber-50/60"}`}>
              <h2 className={`text-sm font-semibold mb-1 ${isDark ? "" : "text-gray-900"}`}>
                Waiting for approval
              </h2>
              <p className={`text-xs mb-4 ${subtle}`}>
                These people verified a code but can't get in until you let them.
              </p>
              <div className="flex flex-col gap-3">
                {incoming.map((user) => (
                  <div key={user.id} className={`flex flex-wrap items-center gap-3 rounded-lg border px-4 py-3 ${card}`}>
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${isDark ? "bg-white/10" : "bg-black/5 text-gray-700"}`}>
                      {initialsFor(user)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{user.name || contact(user)}</p>
                      {user.name && <p className={`text-xs truncate ${subtle}`}>{contact(user)}</p>}
                    </div>
                    <button
                      disabled={busyId === user.id}
                      onClick={() => void mutate("PATCH", user, { status: "approved" })}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-500/15 text-emerald-500 hover:bg-emerald-500/25 transition-colors cursor-pointer disabled:opacity-50"
                    >
                      Approve
                    </button>
                    <button
                      disabled={busyId === user.id}
                      onClick={() => void mutate("PATCH", user, { status: "denied" })}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer disabled:opacity-50 ${
                        isDark ? "bg-white/5 text-gray-400 hover:bg-white/10" : "bg-black/5 text-gray-600 hover:bg-black/10"
                      }`}
                    >
                      Deny
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className={`rounded-xl border overflow-hidden ${card}`}>
            {rest.length === 0 && (
              <p className={`text-sm p-5 ${subtle}`}>No users yet.</p>
            )}
            {rest.map((user, i) => (
              <div
                key={user.id}
                className={`flex flex-wrap items-center gap-3 px-5 py-4 ${
                  i > 0 ? (isDark ? "border-t border-white/5" : "border-t border-gray-100") : ""
                }`}
              >
                <div className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${isDark ? "bg-white/10" : "bg-black/5 text-gray-700"}`}>
                  {initialsFor(user)}
                </div>

                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">
                    {user.name || contact(user)}
                    {user.id === me?.id && <span className={`ml-2 text-xs font-normal ${subtle}`}>you</span>}
                  </p>
                  <p className={`text-xs truncate ${subtle}`}>{user.name ? contact(user) : ""}</p>
                </div>

                <span className={`hidden sm:block text-xs ${subtle}`}>{since(user.lastLoginAt)}</span>

                <span className={`px-2 py-1 rounded-md text-[11px] font-medium ${statusStyles(user.status, isDark)}`}>
                  {user.status === "approved" ? "Active" : user.status === "denied" ? "Denied" : "Incoming"}
                </span>

                <select
                  value={user.role}
                  disabled={busyId === user.id || user.id === me?.id || (user.role === "owner" && !canSetOwner)}
                  onChange={(e) => void mutate("PATCH", user, { role: e.target.value })}
                  className={`px-2 py-1.5 rounded-lg text-xs border transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                    isDark ? "bg-white/[0.04] border-white/10 text-gray-300" : "bg-white border-gray-200 text-gray-700"
                  }`}
                >
                  {(["admin", "member", "viewer", ...(canSetOwner || user.role === "owner" ? ["owner"] : [])] as Role[]).map((r) => (
                    <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                  ))}
                </select>

                {user.status === "denied" ? (
                  <button
                    disabled={busyId === user.id}
                    onClick={() => void mutate("PATCH", user, { status: "approved" })}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-500/15 text-emerald-500 hover:bg-emerald-500/25 transition-colors cursor-pointer disabled:opacity-50"
                  >
                    Restore
                  </button>
                ) : (
                  <button
                    disabled={busyId === user.id || user.id === me?.id}
                    onClick={() => void mutate("PATCH", user, { status: "denied" })}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                      isDark ? "bg-white/5 text-gray-400 hover:bg-white/10" : "bg-black/5 text-gray-600 hover:bg-black/10"
                    }`}
                  >
                    Revoke
                  </button>
                )}

                <button
                  disabled={busyId === user.id || user.id === me?.id}
                  onClick={() => {
                    if (confirm(`Remove ${user.name || contact(user)} entirely?`)) void mutate("DELETE", user);
                  }}
                  title="Remove user"
                  className={`p-1.5 rounded-lg transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed ${
                    isDark ? "text-gray-500 hover:text-red-400 hover:bg-white/5" : "text-gray-400 hover:text-red-600 hover:bg-black/5"
                  }`}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.6} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                  </svg>
                </button>
              </div>
            ))}
          </section>
        </>
      )}
    </div>
  );
}
