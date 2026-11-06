/**
 * The browser's side of signing in (docs/DESIGN.md §9.4): the session in
 * localStorage, every account signed in on this device (Gmail-style), and
 * the role checks the screens use. The server decides access (lib/auth.ts);
 * these only choose what to show.
 */

/** "email" = Email only: signs in to their own inbox and nothing else. */
/** "partner" = an entity's owner or member, invited to see only the entities they're on. */
export type Role = "owner" | "admin" | "member" | "viewer" | "email" | "partner";
export type Status = "incoming" | "approved" | "denied";

export type User = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  phoneFormatted: string;
  role: Role;
  status: Status;
  createdAt: string;
  approvedAt: string | null;
  lastLoginAt: string | null;
  lastSeenAt?: string | null;
  /** Their address on the family domain, once assigned. */
  mailAddress?: string | null;
};

type Session = {
  token: string;
  expiresAt: string;
  user: User;
  /** When it stopped being the current account (ms), while it waits in the list. */
  waitingSince?: number;
};

const STORAGE_KEY = "bfo-session";
/** The other accounts signed in on this browser, ready to switch to (current one excluded). */
const ACCOUNTS_KEY = "bfo-accounts";
/** Set while signing in an extra account, so the sign-in page can offer to go back. */
const ADDING_KEY = "bfo-adding-account";

let cached: Session | null | undefined;

function read(): Session | null {
  if (typeof window === "undefined") return null;
  if (cached !== undefined) return cached;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Session) : null;
    cached = parsed?.token && parsed?.user ? parsed : null;
  } catch {
    cached = null;
  }
  return cached;
}

function write(session: Session | null) {
  cached = session;
  if (typeof window === "undefined") return;
  if (session) localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  else localStorage.removeItem(STORAGE_KEY);
}

function expired(session: Session): boolean {
  const at = Date.parse(session.expiresAt);
  return Number.isFinite(at) && at < Date.now();
}

// ── More than one account ─────────────────────────────────────────────
//
// Like Gmail's account switcher: every account signed in on this browser
// keeps its own session. One is current (STORAGE_KEY); the rest wait in
// ACCOUNTS_KEY. Switching swaps them and reloads, so nothing one account
// loaded is shown to another.

function readAccounts(): Session[] {
  if (typeof window === "undefined") return [];
  try {
    const list = JSON.parse(localStorage.getItem(ACCOUNTS_KEY) ?? "[]") as Session[];
    return Array.isArray(list) ? list.filter((s) => s?.token && s?.user && !expired(s) && s.user.role !== "partner") : [];
  } catch {
    return [];
  }
}

function writeAccounts(list: Session[]) {
  if (typeof window === "undefined") return;
  if (list.length) localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(list));
  else localStorage.removeItem(ACCOUNTS_KEY);
}

/** Ends a session on the server (best effort) and forgets what the palette remembered for it. */
function revoke(session: Session) {
  void fetch("/api/auth/session", { method: "DELETE", headers: { Authorization: `Bearer ${session.token}` } }).catch(() => {});
  forgetRecents(session.user.id);
}

/** The palette's recent places for an account (app/shell-model.ts recentKey), and the old shared list. */
function forgetRecents(userId: string) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(`bfo-recent:${userId}`);
    localStorage.removeItem("bfo-recent");
  } catch {
    // Nothing kept, then.
  }
}

/**
 * Whether a session may wait in the list for a one-tap switch. A partner's
 * never does: on a shared browser, the next person mustn't be a tap away
 * from an invited owner's entities.
 */
function keepsWaiting(session: Session | null): session is Session {
  return !!session && !expired(session) && session.user.role !== "partner";
}

/** Moves the current session into the waiting list (or ends it, for a partner). */
function stepAside(current: Session | null, rest: Session[]): Session[] {
  if (!current) return rest;
  if (keepsWaiting(current)) return [{ ...current, waitingSince: Date.now() }, ...rest.filter((s) => s.user.id !== current.user.id)];
  if (!expired(current)) revoke(current);
  return rest;
}

/** A session just signed in becomes current; the same person waiting in the list is dropped. */
function signIn(session: Session) {
  write(session);
  writeAccounts(readAccounts().filter((s) => s.user.id !== session.user.id));
  if (typeof window !== "undefined") sessionStorage.removeItem(ADDING_KEY);
}

/** The other accounts signed in on this browser. */
export function otherAccounts(): User[] {
  const me = read()?.user.id;
  return readAccounts()
    .filter((s) => s.user.id !== me)
    .map((s) => s.user);
}

/** How long an account can wait in the list and still be switched to without a fresh code. */
export const SWITCH_IDLE_MS = 15 * 60_000;

/**
 * Make another signed-in account the current one. The caller reloads.
 * "stale": it has waited longer than `maxIdleMs`, so it is signed out and
 * needs a fresh code (the caller sends the person to sign in).
 */
export function switchTo(userId: string, o: { maxIdleMs?: number; now?: number } = {}): "ok" | "stale" | "missing" {
  const list = readAccounts();
  const target = list.find((s) => s.user.id === userId);
  if (!target) return "missing";
  const rest = list.filter((s) => s.user.id !== userId);
  if (o.maxIdleMs !== undefined && target.waitingSince && (o.now ?? Date.now()) - target.waitingSince > o.maxIdleMs) {
    revoke(target);
    writeAccounts(rest);
    return "stale";
  }
  writeAccounts(stepAside(read(), rest));
  const { waitingSince: _w, ...session } = target;
  void _w;
  write(session);
  return "ok";
}

/** Make another signed-in account the current one, however long it has waited. */
export function switchAccount(userId: string): boolean {
  return switchTo(userId) === "ok";
}

/** Step aside to sign in one more account; the current one waits in the list (a partner's is signed out). */
export function beginAddAccount() {
  const current = read();
  if (keepsWaiting(current)) sessionStorage.setItem(ADDING_KEY, current.user.id);
  writeAccounts(stepAside(current, readAccounts()));
  write(null);
}

/** Whether the sign-in page is open to add an account (and can go back to it). */
export function addingAccount(): User | null {
  if (typeof window === "undefined") return null;
  const id = sessionStorage.getItem(ADDING_KEY);
  return (id && readAccounts().find((s) => s.user.id === id)?.user) || null;
}

/** Give up adding an account: back to the one we came from. */
export function cancelAddAccount(): boolean {
  const back = addingAccount();
  sessionStorage.removeItem(ADDING_KEY);
  return back ? switchAccount(back.id) : false;
}

/** Synchronous gate used by route guards — the server revalidates separately. */
export function isAuthenticated(): boolean {
  const session = read();
  if (!session) return false;
  if (expired(session)) {
    write(null);
    return false;
  }
  return session.user.status === "approved";
}

export function getUser(): User | null {
  const session = read();
  return session && !expired(session) ? session.user : null;
}

export function getToken(): string | null {
  const session = read();
  return session && !expired(session) ? session.token : null;
}

export function isAdmin(user: User | null = getUser()): boolean {
  return user?.role === "owner" || user?.role === "admin";
}

/** Who may change records (lib/auth.ts canWrite): owners, admins and members. */
export function canWrite(user: User | null = getUser()): boolean {
  return user?.role === "owner" || user?.role === "admin" || user?.role === "member";
}

export function isEmailOnly(user: User | null = getUser()): boolean {
  return user?.role === "email";
}

export function isPartner(user: User | null = getUser()): boolean {
  return user?.role === "partner";
}

/** Where a signed-in user lands: the inbox for "Email only", their entities for a partner, Home for everyone else. */
export function homePath(user: User | null = getUser()): string {
  return isEmailOnly(user) ? "/inbox" : isPartner(user) ? "/assets" : "/home";
}

/**
 * Where to go after signing in, from /login's `next`: a path in this app only
 * (starts with one "/"; never "//", and no backslash or control character,
 * which a browser can read as another site), and never back to the sign-in
 * pages. Anything else is null.
 */
export function safeNext(raw: string | null | undefined): string | null {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return null;
  if (/[\u0000-\u001f\\]/.test(raw)) return null;
  if (/^\/(login|complete-profile)(?:[/?#]|$)/.test(raw)) return null;
  return raw;
}

/** The sign-in page, carrying the page being opened so sign-in comes back to it. */
export function loginPath(): string {
  if (typeof window === "undefined") return "/login";
  const here = safeNext(window.location.pathname + window.location.search);
  return here && here !== "/" ? `/login?next=${encodeURIComponent(here)}` : "/login";
}

/**
 * True once the account has what sign-in needs: a name and a phone, plus a
 * personal email for everyone but "Email only" members.
 */
export function profileComplete(user: User | null | undefined): boolean {
  if (!user?.name || !user.phone) return false;
  return isEmailOnly(user) || isPartner(user) || !!user.email;
}

export function initials(user: User | null = getUser()): string {
  const name = user?.name?.trim();
  if (name) {
    const parts = name.split(/\s+/);
    return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
  }
  if (user?.email) return user.email[0].toUpperCase();
  if (user?.phone) return user.phone.slice(-2);
  return "?";
}

export function displayName(user: User | null = getUser()): string {
  return user?.name?.trim() || user?.email || user?.phoneFormatted || user?.phone || "Signed in";
}

// ── API calls ─────────────────────────────────────────────────────────

export class ApiError extends Error {
  code: string;
  status: number;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(res.status, data?.error ?? "error", data?.message ?? fallbackMessage(data?.error));
  }
  return data as T;
}

function fallbackMessage(code?: string): string {
  switch (code) {
    case "not_configured":
      return "Sign-in isn't configured yet. Check the Bird and Supabase keys.";
    case "unauthorized":
      return "Your session expired. Sign in again.";
    default:
      return "Something went wrong. Try again.";
  }
}

/** Authenticated fetch — carries the session token and clears it on 401. */
export async function authFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = getToken();
  const res = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  // Only a dead session signs the user out. Other 401s (a bank that needs
  // reconnecting, an upstream API refusing us) are the page's to explain.
  if (res.status === 401) {
    const body = await res
      .clone()
      .json()
      .catch(() => null);
    if (!body || body.error === "unauthorized") write(null);
  }
  return res;
}

export async function requestCode(identifier: string) {
  return post<{
    sent: true;
    kind: "phone" | "email";
    identifier: string;
    masked: string;
    expiresIn: number;
  }>("/api/auth/request-code", { identifier });
}

export async function verifyCode(identifier: string, code: string) {
  const data = await post<{
    verified: true;
    status: Status;
    token: string | null;
    expiresAt?: string;
    user?: User;
  }>("/api/auth/verify-code", { identifier, code });

  if (data.token && data.user && data.expiresAt) {
    signIn({ token: data.token, expiresAt: data.expiresAt, user: data.user });
  }
  return data;
}

/** Re-check the session against the server; returns false once it's dead. */
export async function revalidate(): Promise<boolean> {
  const session = read();
  if (!session) return false;
  try {
    const res = await authFetch("/api/auth/session");
    // Only a 401 means the session is dead (authFetch has already cleared it).
    if (res.status === 401) {
      write(null);
      return false;
    }
    // A 5xx is a server blip, like being offline: keep the session.
    if (!res.ok) return true;
    const data = (await res.json()) as { user: User };
    write({ ...session, user: data.user });
    return true;
  } catch {
    // Offline or a transient blip — keep the local session and try again later.
    return true;
  }
}

/**
 * Sign the current account out, and only it. No other account becomes
 * current on its own: on a shared computer the next person must choose (and
 * sign in), not land in someone else's mail. Returns the accounts still
 * signed in on this browser, for the sign-in page to offer.
 */
export function logout(): User[] {
  const current = read();
  if (current) revoke(current);
  write(null);
  return otherAccounts();
}

/** Sign every account on this browser out, the current one and the ones waiting. */
export function logoutAll() {
  const current = read();
  if (current) revoke(current);
  for (const s of readAccounts()) revoke(s);
  write(null);
  writeAccounts([]);
  if (typeof sessionStorage !== "undefined") sessionStorage.removeItem(ADDING_KEY);
}
