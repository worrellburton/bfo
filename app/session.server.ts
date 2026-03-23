import { createCookie } from "react-router";

const SITE_PASSWORD = "awds";

export const authCookie = createCookie("bfo-auth", {
  httpOnly: true,
  secure: false,
  sameSite: "lax",
  maxAge: 60 * 60 * 24 * 30, // 30 days
});

export async function isAuthenticated(request: Request): Promise<boolean> {
  const cookieHeader = request.headers.get("Cookie");
  const value = await authCookie.parse(cookieHeader);
  return value === "authenticated";
}

export function checkPassword(password: string): boolean {
  return password === SITE_PASSWORD;
}
