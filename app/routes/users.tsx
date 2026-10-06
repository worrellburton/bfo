import { useEffect, useMemo, useState } from "react";
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

type Tab = "all" | "incoming";

function statusChip(status: Status, isDark: boolean) {
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

function when(iso: string | null): string {
  if (!iso) return "—";
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function Users() {
  const navigate = useNavigate();
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const [users, setUsers] = useState<User[]>([]);
  const [me, setMe] = useState<User | null>(getUser());
  const [tab, setTab] = useState<Tab>("all");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ name: "", phone: "", email: "", role: "member" as Role });
  // Inline rename: which user's name is being edited, and the text so far.
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);

  async function saveName(user: User) {
    if (!renaming || renaming.id !== user.id) return;
    const name = renaming.name.trim();
    setRenaming(null);
    if (!name || name === (user.name ?? "")) return;
    await mutate("PATCH", user, { name });
  }

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
  const canSetOwner = me?.role === "owner";

  const rows = useMemo(() => {
    const base = tab === "incoming" ? incoming : users;
    const q = search.trim().toLowerCase();
    if (!q) return base;
    return base.filter(
      (u) =>
        u.name?.toLowerCase().includes(q) ||
        u.email?.toLowerCase().includes(q) ||
        u.phone?.includes(q.replace(/\D/g, "") || q) ||
        u.phoneFormatted?.toLowerCase().includes(q)
    );
  }, [users, incoming, tab, search]);

  const card = isDark ? "border-white/10 bg-white/[0.02]" : "border-gray-200 bg-white";
  const subtle = isDark ? "text-gray-500" : "text-gray-500";
  const rowBorder = isDark ? "border-white/5" : "border-gray-100";
  const input = `px-3 py-2 max-sm:min-h-[44px] max-sm:text-[16px] rounded-lg text-sm border transition-colors focus:outline-none ${
    isDark
      ? "bg-white/[0.04] border-white/10 text-white placeholder-gray-600 focus:border-white/25"
      : "bg-white border-gray-200 text-gray-900 placeholder-gray-400 focus:border-gray-400"
  }`;
  const th = `text-left text-[11px] uppercase tracking-wider font-medium px-4 py-3 ${
    isDark ? "text-gray-400" : "text-gray-500"
  }`;
  const td = `px-4 py-3 border-t ${rowBorder}`;
  // Phones: each user is a stacked card; cells show their column name.
  const stack = "max-sm:block max-sm:border-t-0 max-sm:px-0 max-sm:py-1 max-sm:before:block max-sm:before:text-[11px] max-sm:before:uppercase max-sm:before:tracking-wider max-sm:before:text-gray-500 max-sm:before:content-[attr(data-label)]";

  const tabCls = (active: boolean) =>
    `flex items-center gap-2 px-4 py-2 max-sm:min-h-[40px] rounded-lg text-sm font-medium transition-colors cursor-pointer ${
      active
        ? isDark ? "bg-white/10 text-white" : "bg-black/5 text-black"
        : isDark ? "text-gray-500 hover:text-white" : "text-gray-500 hover:text-black"
    }`;

  return (
    <div>
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className={`text-2xl font-bold ${isDark ? "" : "text-gray-900"}`}>Users</h1>
          <p className={`text-sm mt-1 ${subtle}`}>
            Who can sign in to BFO, and what they can do once they're in
          </p>
        </div>
        <button
          onClick={() => setAdding((v) => !v)}
          aria-expanded={adding}
          className={`shrink-0 px-4 py-2 max-sm:min-h-[40px] rounded-lg text-sm font-medium transition-colors cursor-pointer ${
            isDark ? "bg-white text-black hover:bg-gray-200" : "bg-gray-900 text-white hover:bg-black"
          }`}
        >
          {adding ? "Cancel" : "Add user"}
        </button>
      </div>

      {error && (
        <div className={`mb-4 rounded-lg px-4 py-3 text-sm ${isDark ? "bg-red-500/10 text-red-400" : "bg-red-50 text-red-700"}`}>
          {error}
        </div>
      )}

      {/* Approval notification — links to the Incoming tab */}
      {tab === "all" && incoming.length > 0 && (
        <button
          onClick={() => setTab("incoming")}
          className={`w-full flex items-center gap-3 rounded-lg px-4 py-3 max-sm:min-h-[44px] mb-4 text-sm text-left transition-colors cursor-pointer ${
            isDark
              ? "bg-amber-500/10 text-amber-400 hover:bg-amber-500/15"
              : "bg-amber-50 text-amber-800 hover:bg-amber-100"
          }`}
        >
          <span className="w-2 h-2 rounded-full bg-amber-400 motion-safe:animate-pulse shrink-0" />
          <span className="flex-1">
            {incoming.length} {incoming.length === 1 ? "person is" : "people are"} waiting for approval
          </span>
          <span className="font-medium">Review →</span>
        </button>
      )}

      {adding && (
        <form onSubmit={addUser} className={`rounded-xl border p-5 mb-4 ${card}`}>
          <div className="grid gap-3 sm:grid-cols-4">
            <input className={input} value={draft.name} placeholder="Name" aria-label="Name" autoComplete="off"
              onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            <input className={input} value={draft.phone} placeholder="Phone" aria-label="Phone" type="tel" inputMode="tel"
              onChange={(e) => setDraft({ ...draft, phone: e.target.value })} />
            <input className={input} value={draft.email} placeholder="Email" aria-label="Email" type="email"
              onChange={(e) => setDraft({ ...draft, email: e.target.value })} />
            <select className={`${input} cursor-pointer`} value={draft.role} aria-label="Role"
              onChange={(e) => setDraft({ ...draft, role: e.target.value as Role })}>
              {(["admin", "member", "viewer", ...(canSetOwner ? ["owner"] : [])] as Role[]).map((r) => (
                <option key={r} value={r}>{ROLE_LABELS[r]}</option>
              ))}
            </select>
          </div>
          <button type="submit" disabled={busyId === "new"}
            className={`mt-3 px-4 py-2 max-sm:min-h-[40px] rounded-lg text-sm font-medium transition-colors cursor-pointer disabled:opacity-50 ${
              isDark ? "bg-white text-black hover:bg-gray-200" : "bg-gray-900 text-white hover:bg-black"
            }`}>
            {busyId === "new" ? "Adding…" : "Add user"}
          </button>
        </form>
      )}

      {/* Subtabs + search */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <button className={tabCls(tab === "all")} onClick={() => setTab("all")}>
          All users
          <span className={`text-xs ${tab === "all" ? subtle : ""}`}>{users.length}</span>
        </button>
        <button className={tabCls(tab === "incoming")} onClick={() => setTab("incoming")}>
          Incoming
          {incoming.length > 0 && (
            <span className="min-w-[18px] h-[18px] px-1.5 rounded-full bg-amber-500 text-black text-[10px] font-bold flex items-center justify-center">
              {incoming.length}
            </span>
          )}
        </button>
        <div className="flex-1 max-sm:hidden" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, email, phone…"
          aria-label="Search users"
          type="search"
          className={`${input} w-56 max-sm:w-full`}
        />
      </div>

      {/* The spreadsheet */}
      <div className={`rounded-xl border overflow-hidden ${card}`}>
        <div className="sm:overflow-x-auto">
          <table className="w-full text-sm border-collapse max-sm:block sm:min-w-[860px]">
            <thead className="max-sm:hidden">
              <tr className={isDark ? "bg-white/[0.03]" : "bg-gray-50"}>
                <th className={th}>Name</th>
                <th className={th}>Email</th>
                <th className={th}>Phone</th>
                <th className={th}>Role</th>
                <th className={th}>Status</th>
                <th className={th}>Last active</th>
                <th className={th}>Added</th>
                <th className={`${th} text-right`}>Actions</th>
              </tr>
            </thead>
            <tbody className="max-sm:block">
              {loading && (
                <tr className="max-sm:block"><td colSpan={8} className={`${td} ${subtle} max-sm:block max-sm:border-t-0`}>Loading…</td></tr>
              )}
              {!loading && rows.length === 0 && (
                <tr className="max-sm:block">
                  <td colSpan={8} className={`${td} ${subtle} max-sm:block max-sm:border-t-0`}>
                    {tab === "incoming" ? "No one is waiting for approval." : "No users match."}
                  </td>
                </tr>
              )}
              {rows.map((user) => {
                const self = user.id === me?.id;
                const lockRole = busyId === user.id || self || (user.role === "owner" && !canSetOwner);
                return (
                  <tr
                    key={user.id}
                    className={`${isDark ? "hover:bg-white/[0.02]" : "hover:bg-gray-50/60"} max-sm:grid max-sm:grid-cols-2 max-sm:gap-x-4 max-sm:gap-y-1 max-sm:border-t max-sm:first:border-t-0 max-sm:px-4 max-sm:py-3 ${rowBorder}`}
                  >
                    <td className={`${td} whitespace-nowrap max-sm:col-span-2 max-sm:block max-sm:border-t-0 max-sm:px-0 max-sm:py-1 max-sm:whitespace-normal`}>
                      <span className="flex items-center gap-2.5">
                        <span className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${isDark ? "bg-white/10" : "bg-black/5 text-gray-700"}`}>
                          {initialsFor(user)}
                        </span>
                        {renaming?.id === user.id ? (
                          <input
                            autoFocus
                            value={renaming.name}
                            onChange={(e) => setRenaming({ id: user.id, name: e.target.value })}
                            onFocus={(e) => e.currentTarget.select()}
                            onBlur={() => void saveName(user)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") e.currentTarget.blur();
                              if (e.key === "Escape") setRenaming(null);
                            }}
                            placeholder="Full name"
                            aria-label={`Name for ${user.email ?? user.phoneFormatted ?? "user"}`}
                            className={`h-7 w-60 max-w-full max-sm:h-[40px] max-sm:text-[16px] rounded-md border px-2 text-[13px] font-medium outline-none ${
                              isDark ? "border-white/20 bg-white/[0.04] text-white focus:border-white/40" : "border-gray-300 bg-white text-gray-900 focus:border-gray-500"
                            }`}
                          />
                        ) : (
                          <button
                            type="button"
                            onClick={() => setRenaming({ id: user.id, name: user.name ?? "" })}
                            disabled={busyId === user.id || (user.role === "owner" && !canSetOwner && !self)}
                            title="Rename"
                            className={`group inline-flex items-center gap-1.5 max-sm:min-h-[40px] rounded-md text-left font-medium cursor-pointer disabled:cursor-default ${
                              isDark ? "hover:text-white" : "hover:text-gray-900"
                            }`}
                          >
                            <span className={user.name ? "" : subtle}>{user.name || "Add a name"}</span>
                            {self && <span className={`text-xs font-normal ${subtle}`}>you</span>}
                            <svg className={`h-3 w-3 opacity-0 transition-opacity group-hover:opacity-60 group-focus-visible:opacity-60 group-disabled:hidden`} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536M4 20h4L18.5 9.5a2.5 2.5 0 00-3.536-3.536L4.5 16.5 4 20z" />
                            </svg>
                          </button>
                        )}
                      </span>
                    </td>
                    <td data-label="Email" className={`${td} whitespace-nowrap ${user.email ? "" : subtle} ${stack} max-sm:col-span-2 max-sm:whitespace-normal max-sm:break-all`}>{user.email ?? "—"}</td>
                    <td data-label="Phone" className={`${td} whitespace-nowrap tabular-nums ${user.phone ? "" : subtle} ${stack}`}>
                      {user.phoneFormatted || user.phone || "—"}
                    </td>
                    <td data-label="Role" className={`${td} whitespace-nowrap ${stack}`}>
                      <select
                        aria-label={`Role for ${user.name || user.email || user.phoneFormatted || "user"}`}
                        value={user.role}
                        disabled={lockRole}
                        onChange={(e) => void mutate("PATCH", user, { role: e.target.value })}
                        className={`px-2 py-1 max-sm:min-h-[40px] max-sm:text-[16px] rounded-md text-xs border transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                          isDark ? "bg-white/[0.04] border-white/10 text-gray-300" : "bg-white border-gray-200 text-gray-700"
                        }`}
                      >
                        {(["admin", "member", "viewer", ...(canSetOwner || user.role === "owner" ? ["owner"] : [])] as Role[]).map((r) => (
                          <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                        ))}
                      </select>
                    </td>
                    <td data-label="Status" className={`${td} whitespace-nowrap ${stack} max-sm:before:mb-1`}>
                      <span className={`px-2 py-1 rounded-md text-[11px] font-medium ${statusChip(user.status, isDark)}`}>
                        {user.status === "approved" ? "Active" : user.status === "denied" ? "Denied" : "Incoming"}
                      </span>
                    </td>
                    <td data-label="Last active" className={`${td} whitespace-nowrap tabular-nums ${subtle} ${stack}`}>{when(user.lastSeenAt ?? user.lastLoginAt)}</td>
                    <td data-label="Added" className={`${td} whitespace-nowrap tabular-nums ${subtle} ${stack}`}>{when(user.createdAt)}</td>
                    <td className={`${td} whitespace-nowrap text-right max-sm:col-span-2 max-sm:block max-sm:border-t-0 max-sm:px-0 max-sm:pt-2 max-sm:pb-0 max-sm:text-left`}>
                      <span className="inline-flex items-center gap-1.5">
                        {user.status === "incoming" && (
                          <>
                            <button
                              disabled={busyId === user.id}
                              onClick={() => void mutate("PATCH", user, { status: "approved" })}
                              className={`px-2.5 py-1 max-sm:min-h-[40px] max-sm:px-3.5 rounded-md text-xs font-medium transition-colors cursor-pointer disabled:opacity-50 ${isDark ? "bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25" : "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"}`}
                            >
                              Approve
                            </button>
                            <button
                              disabled={busyId === user.id}
                              onClick={() => void mutate("PATCH", user, { status: "denied" })}
                              className={`px-2.5 py-1 max-sm:min-h-[40px] max-sm:px-3.5 rounded-md text-xs font-medium transition-colors cursor-pointer disabled:opacity-50 ${
                                isDark ? "bg-white/5 text-gray-400 hover:bg-white/10" : "bg-black/5 text-gray-600 hover:bg-black/10"
                              }`}
                            >
                              Deny
                            </button>
                          </>
                        )}
                        {user.status === "approved" && (
                          <button
                            disabled={busyId === user.id || self}
                            onClick={() => void mutate("PATCH", user, { status: "denied" })}
                            className={`px-2.5 py-1 max-sm:min-h-[40px] max-sm:px-3.5 rounded-md text-xs font-medium transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                              isDark ? "bg-white/5 text-gray-400 hover:bg-white/10" : "bg-black/5 text-gray-600 hover:bg-black/10"
                            }`}
                          >
                            Revoke
                          </button>
                        )}
                        {user.status === "denied" && (
                          <button
                            disabled={busyId === user.id}
                            onClick={() => void mutate("PATCH", user, { status: "approved" })}
                            className={`px-2.5 py-1 max-sm:min-h-[40px] max-sm:px-3.5 rounded-md text-xs font-medium transition-colors cursor-pointer disabled:opacity-50 ${isDark ? "bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25" : "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"}`}
                          >
                            Restore
                          </button>
                        )}
                        <button
                          disabled={busyId === user.id || self}
                          onClick={() => {
                            if (confirm(`Remove ${user.name || user.email || user.phoneFormatted} entirely?`)) {
                              void mutate("DELETE", user);
                            }
                          }}
                          title="Remove user"
                          aria-label={`Remove ${user.name || user.email || user.phoneFormatted || "user"}`}
                          className={`p-1.5 max-sm:inline-flex max-sm:min-h-[44px] max-sm:min-w-[44px] max-sm:items-center max-sm:justify-center rounded-md transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed ${
                            isDark ? "text-gray-500 hover:text-red-400 hover:bg-white/5" : "text-gray-400 hover:text-red-600 hover:bg-black/5"
                          }`}
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.6} viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                          </svg>
                        </button>
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
