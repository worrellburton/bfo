import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

/**
 * The app's own confirm / alert dialog, in place of the browser's
 * `confirm()` and `alert()` (which show the site's domain, can't be styled,
 * and look like a phishing prompt). Imperative so a handler reads the same:
 *
 *   if (!(await confirmDialog({ title: "Delete this entity?", tone: "danger" }))) return;
 */

export type ConfirmOptions = {
  title: string;
  message?: React.ReactNode;
  /** Bullet points under the message — what will happen. */
  details?: string[];
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "danger" | "default";
  /** Make the person type this (e.g. the entity's name) before confirming. */
  requireText?: string;
  /** Alert mode: a single OK button. */
  alert?: boolean;
};

function isDarkNow(): boolean {
  const html = document.documentElement;
  if (html.classList.contains("light") || html.dataset.theme === "light") return false;
  if (html.classList.contains("dark") || html.dataset.theme === "dark") return true;
  try {
    const saved = localStorage.getItem("bfo-theme");
    if (saved) return saved !== "light";
  } catch {
    // fall through to the system setting
  }
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? true;
}

function Dialog({ opts, onDone }: { opts: ConfirmOptions; onDone: (ok: boolean) => void }) {
  const dark = isDarkNow();
  const [typed, setTyped] = useState("");
  const [closing, setClosing] = useState(false);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const danger = opts.tone === "danger";
  const needs = opts.requireText?.trim();
  const ready = !needs || typed.trim().toLowerCase() === needs.toLowerCase();

  const finish = (ok: boolean) => {
    if (closing) return;
    setClosing(true);
    setTimeout(() => onDone(ok), 120);
  };

  useEffect(() => {
    (needs ? inputRef.current : opts.alert || !danger ? confirmRef.current : null)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        finish(!!opts.alert);
      }
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const panel = dark ? "border-white/10 bg-[#111113] text-white" : "border-gray-200 bg-white text-gray-900";
  const muted = dark ? "text-gray-400" : "text-gray-600";
  const btn = "inline-flex h-10 max-sm:h-[46px] items-center justify-center rounded-full px-5 text-[14px] font-medium transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-40";
  const cancelCls = dark ? "border border-white/15 text-gray-200 hover:bg-white/10" : "border border-gray-200 text-gray-700 hover:bg-gray-100";
  const okCls = danger
    ? "bg-red-500 text-white hover:bg-red-600"
    : dark ? "bg-white text-black hover:bg-gray-200" : "bg-gray-900 text-white hover:bg-gray-700";

  return (
    <div className={`fixed inset-0 z-[120] flex items-end justify-center p-3 sm:items-center sm:p-6 ${closing ? "opacity-0 transition-opacity duration-100" : ""}`}>
      <div className="palette-backdrop absolute inset-0 bg-black/55 backdrop-blur-[2px]" onClick={() => finish(!!opts.alert)} />
      <div
        role={opts.alert ? "alertdialog" : "dialog"}
        aria-modal="true"
        aria-labelledby="bfo-dialog-title"
        className={`palette-panel relative w-full max-w-[420px] rounded-2xl border p-5 shadow-2xl sm:p-6 ${panel}`}
        style={{ marginBottom: "env(safe-area-inset-bottom)" }}
      >
        {danger && (
          <div className={`mb-4 flex h-10 w-10 items-center justify-center rounded-full ${dark ? "bg-red-500/15 text-red-400" : "bg-red-50 text-red-600"}`}>
            <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m0 3.75h.008M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            </svg>
          </div>
        )}
        <h2 id="bfo-dialog-title" className="text-[16px] font-semibold leading-snug">{opts.title}</h2>
        {opts.message && <div className={`mt-2 text-[14px] leading-relaxed ${muted}`}>{opts.message}</div>}
        {opts.details && opts.details.length > 0 && (
          <ul className={`mt-3 space-y-1.5 text-[13px] ${muted}`}>
            {opts.details.map((d, i) => (
              <li key={i} className="flex gap-2">
                <span className={`mt-[7px] h-1 w-1 shrink-0 rounded-full ${dark ? "bg-gray-500" : "bg-gray-400"}`} />
                <span>{d}</span>
              </li>
            ))}
          </ul>
        )}
        {needs && (
          <label className="mt-4 block">
            <span className={`text-[12px] ${muted}`}>
              Type <span className={`font-semibold ${dark ? "text-white" : "text-gray-900"}`}>{needs}</span> to confirm
            </span>
            <input
              ref={inputRef}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && ready && finish(true)}
              autoComplete="off"
              spellCheck={false}
              className={`mt-1.5 h-10 w-full rounded-lg border px-3 text-[16px] sm:text-[14px] outline-none ${
                dark ? "border-white/15 bg-white/5 focus:border-white/30" : "border-gray-300 bg-white focus:border-gray-500"
              }`}
            />
          </label>
        )}
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          {!opts.alert && (
            <button type="button" className={`${btn} ${cancelCls}`} onClick={() => finish(false)}>
              {opts.cancelLabel ?? "Cancel"}
            </button>
          )}
          <button ref={confirmRef} type="button" disabled={!ready} className={`${btn} ${okCls}`} onClick={() => finish(true)}>
            {opts.confirmLabel ?? (opts.alert ? "OK" : danger ? "Delete" : "Confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Show the dialog; resolves true when confirmed. Safe to call from any handler. */
export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  if (typeof document === "undefined") return Promise.resolve(false);
  return new Promise((resolve) => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const returnFocus = document.activeElement as HTMLElement | null;
    root.render(
      <Dialog
        opts={opts}
        onDone={(ok) => {
          root.unmount();
          host.remove();
          returnFocus?.focus?.();
          resolve(ok);
        }}
      />
    );
  });
}

/** An in-app alert: one message, one OK. */
export function alertDialog(title: string, message?: React.ReactNode): Promise<void> {
  return confirmDialog({ title, message, alert: true }).then(() => undefined);
}
