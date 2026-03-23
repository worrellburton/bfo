const SITE_PASSWORD = "awds";
const STORAGE_KEY = "bfo-authenticated";

export function isAuthenticated(): boolean {
  if (typeof window === "undefined") return false;
  return sessionStorage.getItem(STORAGE_KEY) === "true";
}

export function authenticate(password: string): boolean {
  if (password === SITE_PASSWORD) {
    sessionStorage.setItem(STORAGE_KEY, "true");
    return true;
  }
  return false;
}

export function logout(): void {
  sessionStorage.removeItem(STORAGE_KEY);
}
