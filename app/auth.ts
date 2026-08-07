export type SessionUser = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  role: "owner" | "member";
};

type StoredSession = { token: string; user: SessionUser };

const STORAGE_KEY = "bfo-session";

function readSession(): StoredSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredSession;
    return parsed?.token && parsed?.user ? parsed : null;
  } catch {
    return null;
  }
}

export function isAuthenticated(): boolean {
  return readSession() !== null;
}

export function getUser(): SessionUser | null {
  return readSession()?.user ?? null;
}

export function getToken(): string | null {
  return readSession()?.token ?? null;
}

export function setSession(token: string, user: SessionUser): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ token, user }));
}

export function logout(): void {
  const token = getToken();
  localStorage.removeItem(STORAGE_KEY);
  if (token) {
    // Best-effort server-side session revocation.
    authFetch("logout", {}, token).catch(() => {});
  }
}

export async function authFetch(
  action: string,
  payload: Record<string, unknown> = {},
  tokenOverride?: string
): Promise<any> {
  const token = tokenOverride ?? getToken();
  const res = await fetch("/api/auth", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ action, ...payload }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && !tokenOverride) {
      // Session expired or revoked server-side.
      localStorage.removeItem(STORAGE_KEY);
    }
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}
