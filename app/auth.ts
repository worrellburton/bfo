export type Role = "owner" | "admin" | "member" | "viewer";
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
};

type Session = {
  token: string;
  expiresAt: string;
  user: User;
};

const STORAGE_KEY = "bfo-session";
const LEGACY_KEY = "bfo-authenticated";

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
  if (res.status === 401) write(null);
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
    write({ token: data.token, expiresAt: data.expiresAt, user: data.user });
  }
  return data;
}

/** Re-check the session against the server; returns false once it's dead. */
export async function revalidate(): Promise<boolean> {
  const session = read();
  if (!session) return false;
  try {
    const res = await authFetch("/api/auth/session");
    if (!res.ok) {
      write(null);
      return false;
    }
    const data = (await res.json()) as { user: User };
    write({ ...session, user: data.user });
    return true;
  } catch {
    // Offline or a transient blip — keep the local session and try again later.
    return true;
  }
}

export function logout(): void {
  const token = getToken();
  if (token) {
    void fetch("/api/auth/session", {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => {});
  }
  write(null);
  if (typeof window !== "undefined") sessionStorage.removeItem(LEGACY_KEY);
}
