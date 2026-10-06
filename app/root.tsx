import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "react-router";

import type { Route } from "./+types/root";
import "./app.css";
import { ThemeProvider } from "./theme";
import { SIDEBAR_BOOT_SCRIPT } from "./sidebar";

export const links: Route.LinksFunction = () => [
  { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
  { rel: "icon", href: "/favicon-32.png", type: "image/png", sizes: "32x32" },
  { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  {
    rel: "preconnect",
    href: "https://fonts.gstatic.com",
    crossOrigin: "anonymous",
  },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Geist:wght@100..900&family=Geist+Mono:wght@400..600&family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&display=swap",
  },
];

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        {/* Phone browser chrome matches the app instead of flashing white. */}
        <meta name="theme-color" content="#000000" media="(prefers-color-scheme: dark)" />
        <meta name="theme-color" content="#f9fafb" media="(prefers-color-scheme: light)" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="BFO" />
        <Meta />
        <Links />
        {/* Applies the saved sidebar width before first paint. */}
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

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const notFound = isRouteErrorResponse(error) && error.status === 404;
  const title = notFound ? "This page isn't here" : "Something went wrong";
  const details = notFound
    ? "The address doesn't match any page."
    : isRouteErrorResponse(error)
      ? error.statusText || "The page failed to load."
      : "The page hit an unexpected error. Reloading usually fixes it — if it keeps happening, tell us what you were doing.";
  const stack = import.meta.env.DEV && error instanceof Error ? error.stack : undefined;

  return (
    <main className="flex min-h-screen items-center justify-center bg-black px-6 text-white">
      <div className="w-full max-w-md text-center">
        <p className="text-[22px] font-bold tracking-[0.16em]">BFO</p>
        <h1 className="mt-8 text-[20px] font-semibold">{title}</h1>
        <p className="mt-2 text-sm text-gray-400">{details}</p>
        <div className="mt-6 flex justify-center gap-2">
          {!notFound && (
            <button
              onClick={() => window.location.reload()}
              className="rounded-full bg-white px-5 py-2 text-sm font-medium text-black hover:bg-gray-200"
            >
              Reload
            </button>
          )}
          <a href="/home" className="rounded-full border border-white/15 px-5 py-2 text-sm text-gray-200 hover:bg-white/10">
            Go home
          </a>
        </div>
        {stack && (
          <pre className="mt-8 max-h-64 overflow-auto rounded-xl bg-white/5 p-4 text-left text-xs text-gray-400">
            <code>{stack}</code>
          </pre>
        )}
      </div>
    </main>
  );
}
