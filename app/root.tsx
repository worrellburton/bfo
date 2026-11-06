import { isRouteErrorResponse, Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";

import type { Route } from "./+types/root";
import "./app.css";
import { ErrorPage } from "./ui";
import { useLayoutEffect } from "react";
import { applySavedTheme, ThemeProvider } from "./theme";
import { SIDEBAR_BOOT_SCRIPT } from "./sidebar";
import { startPwa } from "./pwa";

// Early, so Chrome's install offer (beforeinstallprompt) isn't missed.
startPwa();

export const links: Route.LinksFunction = () => [
  { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
  { rel: "icon", href: "/favicon-32.png", type: "image/png", sizes: "32x32" },
  { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
  // Installable as an app (Chrome's "Install BFO"; app/pwa.ts).
  { rel: "manifest", href: "/manifest.webmanifest" },
  // Fonts are self-hosted (app.css @font-face; docs/DESIGN.md §3.1): no visitor's address goes to a font service.
  { rel: "preload", href: "/fonts/geist-latin.woff2", as: "font", type: "font/woff2", crossOrigin: "anonymous" },
];

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        {/* The browser chrome's colour follows the app's theme; the boot script sets it before paint. */}
        <meta name="theme-color" content="#0b0b0c" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="BFO" />
        <Meta />
        <Links />
        {/* The theme and the content inset, before first paint (app/sidebar.ts). */}
        <script dangerouslySetInnerHTML={{ __html: SIDEBAR_BOOT_SCRIPT }} />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <Outlet />
    </ThemeProvider>
  );
}

/**
 * A page that can't render at all, or an address no route knows, outside the
 * shell (docs/DESIGN.md §8.18): the same ErrorPage the in-app not-found
 * uses, in the theme the boot script already applied. The message (and in
 * development the stack) sits behind "Technical details".
 */
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const notFound = isRouteErrorResponse(error) && error.status === 404;
  // The app (and its theme) is gone; put the saved theme back on the document.
  useLayoutEffect(() => applySavedTheme(), []);
  const detail = error instanceof Error ? (import.meta.env.DEV ? error.stack || error.message : error.message) : isRouteErrorResponse(error) ? `${error.status} ${error.statusText}`.trim() : undefined;
  return (
    <main className="min-h-dvh bg-page px-(--gutter)">
      <ErrorPage kind={notFound ? "not-found" : "error"} detail={detail} />
    </main>
  );
}
