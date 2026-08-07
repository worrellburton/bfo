import { Link } from "react-router";
import { useEffect, useRef, useState } from "react";
import { useTheme } from "../theme";
import { authFetch, getUser } from "../auth";
import { BACKGROUNDS, WebGLPreview, type BackgroundId } from "../webgl-backgrounds";

export function meta() {
  return [{ title: "BFO - Settings" }];
}

type ManagedUser = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  status: "incoming" | "approved" | "denied";
  role: "owner" | "member";
  verified_at: string | null;
  last_login_at: string | null;
  created_at: string;
};

function userLabel(u: ManagedUser): string {
  return u.name || u.email || u.phone || "Unknown";
}

function userContact(u: ManagedUser): string {
  return [u.email, u.phone].filter(Boolean).join(" · ");
}

function UsersSection({ isDark }: { isDark: boolean }) {
  const [users, setUsers] = useState<ManagedUser[] | null>(null);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");
  const sectionRef = useRef<HTMLElement>(null);
  const me = getUser();

  async function load() {
    try {
      const data = await authFetch("list-users");
      setUsers(data.users || []);
      setError("");
    } catch (err: any) {
      setError(err.message);
      setUsers([]);
    }
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (window.location.hash === "#users" && users !== null) {
      sectionRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [users]);

  async function act(action: string, userId: string) {
    setBusyId(userId);
    try {
      await authFetch(action, { userId });
      await load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusyId("");
    }
  }

  const incoming = (users || []).filter((u) => u.status === "incoming");
  const members = (users || []).filter((u) => u.status === "approved");
  const denied = (users || []).filter((u) => u.status === "denied");

  const rowCls = `flex items-center gap-3 px-4 py-3 rounded-lg ${
    isDark ? "bg-white/[0.03]" : "bg-gray-50"
  }`;
  const primaryText = isDark ? "text-white" : "text-gray-900";
  const mutedText = isDark ? "text-gray-500" : "text-gray-500";
  const approveBtn =
    "px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 hover:bg-emerald-500/20 transition-colors cursor-pointer disabled:opacity-50";
  const dangerBtn = `px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors cursor-pointer disabled:opacity-50 ${
    isDark
      ? "border-white/10 text-red-400 hover:bg-red-500/10"
      : "border-gray-200 text-red-500 hover:bg-red-50"
  }`;

  return (
    <section
      ref={sectionRef}
      id="users"
      className={`rounded-xl border p-6 mt-6 ${isDark ? "border-white/10 bg-white/[0.02]" : "border-gray-200 bg-white"}`}
    >
      <div className="flex items-center gap-3 mb-6">
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${isDark ? "bg-blue-500/10" : "bg-blue-50"}`}>
          <svg className={`w-5 h-5 ${isDark ? "text-blue-400" : "text-blue-600"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </div>
        <div className="flex-1">
          <h2 className={`text-sm font-semibold ${isDark ? "" : "text-gray-900"}`}>Users</h2>
          <p className={`text-xs ${mutedText}`}>Approve incoming requests and manage who can sign in</p>
        </div>
        {incoming.length > 0 && (
          <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-500 border border-amber-500/20">
            {incoming.length} pending
          </span>
        )}
      </div>

      {users === null && <p className={`text-sm ${mutedText}`}>Loading users...</p>}
      {error && <p className="text-sm text-red-400 mb-4">{error}</p>}

      {users !== null && !error && (
        <div className="space-y-6">
          <div>
            <label className={`text-xs font-medium uppercase tracking-wider mb-3 block ${isDark ? "text-gray-400" : "text-gray-500"}`}>
              Incoming requests
            </label>
            {incoming.length === 0 ? (
              <p className={`text-sm ${mutedText}`}>No pending requests</p>
            ) : (
              <div className="space-y-2">
                {incoming.map((u) => (
                  <div key={u.id} className={rowCls}>
                    <div className="flex-1 min-w-0">
                      <div className={`text-sm font-medium truncate ${primaryText}`}>{userLabel(u)}</div>
                      <div className={`text-xs truncate ${mutedText}`}>
                        {userContact(u)}
                        {u.verified_at ? " · verified" : " · not verified yet"}
                      </div>
                    </div>
                    <button className={approveBtn} disabled={busyId === u.id} onClick={() => act("approve-user", u.id)}>
                      Approve
                    </button>
                    <button className={dangerBtn} disabled={busyId === u.id} onClick={() => act("deny-user", u.id)}>
                      Deny
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <label className={`text-xs font-medium uppercase tracking-wider mb-3 block ${isDark ? "text-gray-400" : "text-gray-500"}`}>
              Members
            </label>
            <div className="space-y-2">
              {members.map((u) => (
                <div key={u.id} className={rowCls}>
                  <div className="flex-1 min-w-0">
                    <div className={`text-sm font-medium truncate ${primaryText}`}>
                      {userLabel(u)}
                      {u.id === me?.id && <span className={`ml-2 text-xs font-normal ${mutedText}`}>(you)</span>}
                    </div>
                    <div className={`text-xs truncate ${mutedText}`}>{userContact(u)}</div>
                  </div>
                  <span
                    className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                      u.role === "owner"
                        ? "bg-blue-500/10 text-blue-500 border border-blue-500/20"
                        : isDark
                          ? "bg-white/5 text-gray-400 border border-white/10"
                          : "bg-gray-100 text-gray-500 border border-gray-200"
                    }`}
                  >
                    {u.role}
                  </span>
                  {u.role !== "owner" && (
                    <button className={dangerBtn} disabled={busyId === u.id} onClick={() => act("remove-user", u.id)}>
                      Remove
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {denied.length > 0 && (
            <div>
              <label className={`text-xs font-medium uppercase tracking-wider mb-3 block ${isDark ? "text-gray-400" : "text-gray-500"}`}>
                Denied
              </label>
              <div className="space-y-2">
                {denied.map((u) => (
                  <div key={u.id} className={rowCls}>
                    <div className="flex-1 min-w-0">
                      <div className={`text-sm font-medium truncate ${primaryText}`}>{userLabel(u)}</div>
                      <div className={`text-xs truncate ${mutedText}`}>{userContact(u)}</div>
                    </div>
                    <button className={approveBtn} disabled={busyId === u.id} onClick={() => act("approve-user", u.id)}>
                      Approve
                    </button>
                    <button className={dangerBtn} disabled={busyId === u.id} onClick={() => act("remove-user", u.id)}>
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

export default function Settings() {
  const { theme, toggle, backgroundId, setBackgroundId } = useTheme();
  const isDark = theme === "dark";
  const isOwner = getUser()?.role === "owner";

  return (
    <div>
      <div className="flex items-center gap-3 mb-1">
        <Link to="/tools" className={`${isDark ? "text-gray-500 hover:text-white" : "text-gray-400 hover:text-gray-900"} transition-colors`}>
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <h1 className={`text-2xl font-bold ${isDark ? "" : "text-gray-900"}`}>Settings</h1>
      </div>
      <p className={`text-sm mb-8 ${isDark ? "text-gray-500" : "text-gray-500"}`}>Customize your BFO experience</p>

      {/* Appearance Section */}
      <section className={`rounded-xl border p-6 ${isDark ? "border-white/10 bg-white/[0.02]" : "border-gray-200 bg-white"}`}>
        <div className="flex items-center gap-3 mb-6">
          <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${isDark ? "bg-purple-500/10" : "bg-purple-50"}`}>
            <svg className={`w-5 h-5 ${isDark ? "text-purple-400" : "text-purple-600"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
            </svg>
          </div>
          <div>
            <h2 className={`text-sm font-semibold ${isDark ? "" : "text-gray-900"}`}>Appearance</h2>
            <p className={`text-xs ${isDark ? "text-gray-500" : "text-gray-500"}`}>Theme and background for the BF Access portal</p>
          </div>
        </div>

        {/* Theme Toggle */}
        <div className="mb-6">
          <label className={`text-xs font-medium uppercase tracking-wider mb-3 block ${isDark ? "text-gray-400" : "text-gray-500"}`}>Theme</label>
          <div className="flex gap-2">
            <button
              onClick={() => { if (isDark) toggle(); }}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs font-medium transition-all ${
                !isDark
                  ? "bg-blue-500/10 text-blue-600 border border-blue-500/20"
                  : isDark ? "border border-white/10 text-gray-400 hover:border-white/20" : "border border-gray-200 text-gray-500 hover:border-gray-400"
              }`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" /></svg>
              Light
            </button>
            <button
              onClick={() => { if (!isDark) toggle(); }}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs font-medium transition-all ${
                isDark
                  ? "bg-blue-500/10 text-blue-400 border border-blue-500/20"
                  : "border border-gray-200 text-gray-500 hover:border-gray-400"
              }`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" /></svg>
              Dark
            </button>
          </div>
        </div>

        {/* WebGL Background Picker */}
        <div>
          <label className={`text-xs font-medium uppercase tracking-wider mb-3 block ${isDark ? "text-gray-400" : "text-gray-500"}`}>
            BF Access Background
          </label>
          <p className={`text-xs mb-4 ${isDark ? "text-gray-500" : "text-gray-400"}`}>
            Choose a dynamic background for the public BF Access portal pages
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {BACKGROUNDS.map((bg) => {
              const selected = backgroundId === bg.id;
              return (
                <button
                  key={bg.id}
                  onClick={() => setBackgroundId(bg.id)}
                  className={`group relative rounded-xl overflow-hidden transition-all ${
                    selected
                      ? isDark
                        ? "ring-2 ring-blue-500 ring-offset-2 ring-offset-black"
                        : "ring-2 ring-blue-500 ring-offset-2 ring-offset-white"
                      : isDark
                        ? "border border-white/10 hover:border-white/20"
                        : "border border-gray-200 hover:border-gray-400"
                  }`}
                >
                  <div className="aspect-[16/10] relative">
                    <WebGLPreview backgroundId={bg.id} dark={isDark} />
                    {selected && (
                      <div className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-blue-500 flex items-center justify-center">
                        <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                      </div>
                    )}
                  </div>
                  <div className={`px-2.5 py-2 ${isDark ? "bg-white/[0.03]" : "bg-gray-50"}`}>
                    <div className={`text-xs font-medium ${isDark ? "" : "text-gray-900"}`}>{bg.label}</div>
                    <div className={`text-[10px] ${isDark ? "text-gray-500" : "text-gray-400"}`}>{bg.description}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* Users Section — owner only */}
      {isOwner && <UsersSection isDark={isDark} />}
    </div>
  );
}
