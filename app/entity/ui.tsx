/**
 * The entity page's building blocks. One visual language, deliberately quiet:
 *
 * - A Section is a card with a plain title and optional actions — no kicker
 *   line above the title, no paragraph under it.
 * - Rows are label → value, separated by hairlines. Values carry the weight;
 *   labels are small and muted.
 * - Status is a dot and one or two words (Dot).
 * - Explanations are never shown by default: an (i) button reveals them
 *   (Row `info`, or <Info>), and long lists sit behind a Disclosure.
 * - Buttons come in three weights (primary, secondary, ghost) plus danger.
 *
 * Mobile: the root font is 11.9px, so tap targets are sized in px.
 */

import { useId, useState, type ReactNode } from "react";
import { useTheme } from "../theme";

// ── Theme ────────────────────────────────────────────────────────────────

export function useTone() {
  const { theme } = useTheme();
  const dark = theme === "dark";
  return {
    dark,
    surface: dark ? "border-white/[0.07] bg-white/[0.02]" : "border-gray-200/90 bg-white",
    line: dark ? "border-white/[0.06]" : "border-gray-100",
    divide: dark ? "divide-white/[0.06]" : "divide-gray-100",
    text: dark ? "text-gray-100" : "text-gray-900",
    soft: dark ? "text-gray-400" : "text-gray-600",
    muted: dark ? "text-gray-500" : "text-gray-500",
    faint: dark ? "text-gray-600" : "text-gray-400",
    accent: dark ? "text-[#a5b4fc]" : "text-[#4f46e5]",
    hover: dark ? "hover:bg-white/[0.03]" : "hover:bg-gray-50",
    input: `${dark ? "border-white/10 bg-white/[0.03] text-white focus:border-[#818cf8]/60" : "border-gray-200 bg-white text-gray-900 focus:border-[#4f46e5]/50"} rounded-lg border placeholder:text-gray-500 focus:outline-none transition-colors max-sm:text-[16px]`,
  };
}

// ── Icons ────────────────────────────────────────────────────────────────

const PATHS = {
  chevronLeft: "M15 19l-7-7 7-7",
  chevronDown: "M19 9l-7 7-7-7",
  chevronRight: "M9 5l7 7-7 7",
  doc: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z",
  edit: "M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z",
  trash: "M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M4 7h16M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3",
  plus: "M12 4v16m8-8H4",
  external: "M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14",
  download: "M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4",
  upload: "M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12",
  refresh: "M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15",
  copy: "M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z",
  check: "M5 13l4 4L19 7",
  link: "M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1",
  sparkle: "M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z",
  info: "M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z",
  more: "M6.75 12a.75.75 0 11-1.5 0 .75.75 0 011.5 0zM12.75 12a.75.75 0 11-1.5 0 .75.75 0 011.5 0zM18.75 12a.75.75 0 11-1.5 0 .75.75 0 011.5 0z",
  x: "M6 18L18 6M6 6l12 12",
  mail: "M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75",
  rename: "M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, className = "h-3.5 w-3.5", strokeWidth = 1.75 }: { name: IconName; className?: string; strokeWidth?: number }) {
  return (
    <svg className={`shrink-0 ${className}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={strokeWidth} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d={PATHS[name]} />
    </svg>
  );
}

// ── Buttons ──────────────────────────────────────────────────────────────

type ButtonKind = "primary" | "secondary" | "ghost" | "danger";

export function buttonClass(kind: ButtonKind = "secondary", dark = true, size: "sm" | "md" = "sm") {
  const base = `inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-medium transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 ${
    size === "sm" ? "h-7 px-2.5 text-[12px] max-sm:h-[40px] max-sm:px-3" : "h-8 px-3 text-[12.5px] max-sm:h-[44px]"
  }`;
  const k = {
    primary: dark ? "bg-white text-gray-950 hover:bg-gray-200" : "bg-gray-900 text-white hover:bg-gray-700",
    secondary: dark ? "border border-white/[0.1] text-gray-200 hover:bg-white/[0.05]" : "border border-gray-200 text-gray-700 hover:bg-gray-50",
    ghost: dark ? "text-gray-400 hover:bg-white/[0.05] hover:text-white" : "text-gray-500 hover:bg-gray-100 hover:text-gray-900",
    danger: dark ? "text-red-400 hover:bg-red-500/10" : "text-red-600 hover:bg-red-50",
  }[kind];
  return `${base} ${k}`;
}

export function Button({
  kind = "secondary",
  size = "sm",
  icon,
  children,
  className = "",
  ...rest
}: { kind?: ButtonKind; size?: "sm" | "md"; icon?: IconName; className?: string } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { dark } = useTone();
  return (
    <button type="button" className={`${buttonClass(kind, dark, size)} ${className}`} {...rest}>
      {icon && <Icon name={icon} className="h-3.5 w-3.5" />}
      {children}
    </button>
  );
}

/** A square icon-only button. `label` is its accessible name and tooltip. */
export function IconButton({ icon, label, tone = "ghost", className = "", ...rest }: { icon: IconName; label: string; tone?: "ghost" | "danger" } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { dark } = useTone();
  const t =
    tone === "danger"
      ? dark ? "text-gray-500 hover:bg-red-500/10 hover:text-red-400" : "text-gray-400 hover:bg-red-50 hover:text-red-600"
      : dark ? "text-gray-500 hover:bg-white/[0.06] hover:text-white" : "text-gray-400 hover:bg-gray-100 hover:text-gray-900";
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`inline-flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md transition-colors disabled:opacity-40 max-sm:h-[40px] max-sm:w-[40px] ${t} ${className}`}
      {...rest}
    >
      <Icon name={icon} className="h-3.5 w-3.5" />
    </button>
  );
}

/** Text-weight action, for "Re-read", "Show all", inline links. */
export function TextButton({ children, className = "", ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { accent } = useTone();
  return (
    <button
      type="button"
      className={`relative inline-flex cursor-pointer items-center gap-1 text-[12px] font-medium hover:underline disabled:cursor-wait disabled:opacity-50 max-sm:after:absolute max-sm:after:-inset-y-3 max-sm:after:inset-x-0 max-sm:after:content-[''] ${accent} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

// ── Status ───────────────────────────────────────────────────────────────

export type Tone = "good" | "warn" | "bad" | "muted" | "accent";

export function toneText(tone: Tone, dark: boolean) {
  return {
    good: dark ? "text-emerald-400" : "text-emerald-700",
    warn: dark ? "text-amber-300" : "text-amber-700",
    bad: dark ? "text-red-400" : "text-red-600",
    muted: "text-gray-500",
    accent: dark ? "text-[#a5b4fc]" : "text-[#4f46e5]",
  }[tone];
}

/** A status: a dot and a word or two. */
export function Dot({ tone, children, className = "" }: { tone: Tone; children?: ReactNode; className?: string }) {
  const { dark } = useTone();
  const bg = { good: "bg-emerald-400", warn: "bg-amber-400", bad: "bg-red-400", muted: dark ? "bg-gray-600" : "bg-gray-300", accent: "bg-[#818cf8]" }[tone];
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap text-[12px] ${toneText(tone, dark)} ${className}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${bg}`} aria-hidden="true" />
      {children}
    </span>
  );
}

export function Count({ n, alert = false }: { n?: number; alert?: boolean }) {
  const { dark } = useTone();
  if (!n) return null;
  return (
    <span
      className={`min-w-[18px] rounded-full px-1.5 text-center text-[10.5px] tabular-nums leading-[18px] ${
        alert ? (dark ? "bg-red-400/15 text-red-300" : "bg-red-50 text-red-700") : dark ? "bg-white/[0.07] text-gray-400" : "bg-gray-100 text-gray-500"
      }`}
    >
      {n}
    </span>
  );
}

// ── On-demand explanation ────────────────────────────────────────────────

/** The (i) toggle. Pair with <InfoText open> where the text should appear. */
export function InfoToggle({ open, onToggle, label = "What is this?" }: { open: boolean; onToggle: () => void; label?: string }) {
  const { dark } = useTone();
  return (
    <button
      type="button"
      aria-label={label}
      aria-expanded={open}
      title={label}
      onClick={onToggle}
      className={`relative inline-flex h-4 w-4 shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors max-sm:after:absolute max-sm:after:-inset-3 max-sm:after:content-[''] ${
        open ? (dark ? "text-[#a5b4fc]" : "text-[#4f46e5]") : dark ? "text-gray-600 hover:text-gray-300" : "text-gray-300 hover:text-gray-600"
      }`}
    >
      <Icon name="info" className="h-3.5 w-3.5" strokeWidth={1.6} />
    </button>
  );
}

export function InfoText({ open, children, className = "" }: { open: boolean; children: ReactNode; className?: string }) {
  const { soft } = useTone();
  if (!open) return null;
  return <div className={`mt-1.5 max-w-[68ch] text-[12px] leading-relaxed ${soft} ${className}`}>{children}</div>;
}

/** Inline (i) with its own text, for one-off explanations. */
export function Info({ children, label }: { children: ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <InfoToggle open={open} onToggle={() => setOpen((o) => !o)} label={label} />
      {open && <span className="block w-full basis-full"><InfoText open>{children}</InfoText></span>}
    </>
  );
}

// ── Layout ───────────────────────────────────────────────────────────────

export function Section({
  title,
  count,
  alert,
  actions,
  info,
  children,
  id,
  flush = false,
  className = "",
}: {
  title?: ReactNode;
  count?: number;
  alert?: boolean;
  actions?: ReactNode;
  info?: ReactNode;
  children?: ReactNode;
  id?: string;
  flush?: boolean;
  className?: string;
}) {
  const t = useTone();
  const [open, setOpen] = useState(false);
  return (
    <section id={id} className={`overflow-hidden rounded-2xl border ${t.surface} ${className}`}>
      {(title || actions) && (
        <header className="flex min-h-[48px] items-center justify-between gap-3 px-5 py-3">
          <div className="min-w-0">
            <h2 className={`flex flex-wrap items-center gap-x-2 gap-y-1 text-[13.5px] font-semibold tracking-[-0.005em] ${t.text}`}>
              {title}
              <Count n={count} alert={alert} />
              {info && <InfoToggle open={open} onToggle={() => setOpen((o) => !o)} />}
            </h2>
            {info && <InfoText open={open}>{info}</InfoText>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
        </header>
      )}
      <div className={flush ? "" : `border-t ${t.line}`}>{children}</div>
    </section>
  );
}

/** Rows with hairlines between them. */
export function Rows({ children, className = "" }: { children: ReactNode; className?: string }) {
  const t = useTone();
  return <div className={`divide-y ${t.divide} ${className}`}>{children}</div>;
}

/**
 * label → value, with optional actions on the right and an optional (i)
 * that reveals `info` under the row.
 */
export function Row({
  label,
  children,
  actions,
  info,
  id,
  className = "",
  stacked = false,
  labelWidth = "sm:w-44",
}: {
  label?: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  info?: ReactNode;
  id?: string;
  className?: string;
  stacked?: boolean;
  /** Width of the label column from sm up (Tailwind class). */
  labelWidth?: string;
}) {
  const t = useTone();
  const [open, setOpen] = useState(false);
  return (
    <div id={id} className={`scroll-mt-32 px-5 py-3 lg:scroll-mt-20 ${className}`}>
      <div className={`flex gap-x-4 gap-y-1 ${stacked ? "flex-col" : "flex-col sm:flex-row sm:items-baseline"}`}>
        {label !== undefined && (
          <div className={`flex shrink-0 items-center gap-1.5 text-[12px] ${t.muted} ${stacked ? "" : labelWidth}`}>
            {label}
            {info && <InfoToggle open={open} onToggle={() => setOpen((o) => !o)} />}
          </div>
        )}
        <div className={`min-w-0 flex-1 text-[13px] leading-snug ${t.text}`}>
          {children ?? <span className={t.faint}>—</span>}
          {label === undefined && info && <InfoToggle open={open} onToggle={() => setOpen((o) => !o)} />}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-1 sm:-my-1">{actions}</div>}
      </div>
      {info && <InfoText open={open}>{info}</InfoText>}
    </div>
  );
}

/** A collapsed list: "Label · n" that opens to its children. */
export function Disclosure({ label, count, children, defaultOpen = false }: { label: ReactNode; count?: number; children: ReactNode; defaultOpen?: boolean }) {
  const t = useTone();
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className={`flex w-full cursor-pointer items-center gap-1.5 px-5 py-2.5 text-left text-[12px] transition-colors max-sm:min-h-[44px] ${t.muted} ${t.hover}`}
      >
        <Icon name="chevronRight" className={`h-3 w-3 transition-transform ${open ? "rotate-90" : ""}`} />
        {label}
        {count !== undefined && <span className="tabular-nums">· {count}</span>}
      </button>
      {open && <div id={id}>{children}</div>}
    </div>
  );
}

export function Empty({ children, action }: { children: ReactNode; action?: ReactNode }) {
  const t = useTone();
  return (
    <div className={`flex flex-wrap items-center justify-between gap-3 px-5 py-4 text-[12.5px] ${t.muted}`}>
      <span>{children}</span>
      {action}
    </div>
  );
}

export function ErrorLine({ children }: { children: ReactNode }) {
  const { dark } = useTone();
  if (!children) return null;
  return <p className={`px-5 py-2.5 text-[12px] leading-snug ${dark ? "text-red-300" : "text-red-600"}`}>{children}</p>;
}

// ── Forms ────────────────────────────────────────────────────────────────

export function Field({ label, children, wide = false, hint, className = "" }: { label: string; children: ReactNode; wide?: boolean; hint?: ReactNode; className?: string }) {
  const t = useTone();
  return (
    <label className={`block ${wide ? "md:col-span-2" : ""} ${className}`}>
      <span className={`mb-1.5 block text-[12px] ${t.muted}`}>{label}</span>
      {children}
      {hint && <span className={`mt-1 block text-[11.5px] ${t.faint}`}>{hint}</span>}
    </label>
  );
}

export function inputClass(dark: boolean, extra = "") {
  const t = dark
    ? "border-white/10 bg-white/[0.03] text-white focus:border-[#818cf8]/60"
    : "border-gray-200 bg-white text-gray-900 focus:border-[#4f46e5]/50";
  return `h-8 w-full rounded-lg border px-2.5 text-[13px] placeholder:text-gray-500 transition-colors focus:outline-none max-sm:h-[44px] max-sm:text-[16px] ${t} ${extra}`;
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const { dark } = useTone();
  return <input {...props} className={`${inputClass(dark)} ${props.className ?? ""}`} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  const { dark } = useTone();
  return <select {...props} className={`${inputClass(dark)} cursor-pointer ${props.className ?? ""}`} />;
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const { dark } = useTone();
  return <textarea {...props} className={`${inputClass(dark, "h-auto py-2")} ${props.className ?? ""}`} />;
}

/** A small on/off switch. */
export function Switch({ on, onToggle, label }: { on: boolean; onToggle: () => void; label: string }) {
  const { dark } = useTone();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onToggle}
      className={`relative inline-flex h-[18px] w-[32px] shrink-0 cursor-pointer items-center rounded-full transition-colors ${on ? (dark ? "bg-[#818cf8]" : "bg-[#4f46e5]") : dark ? "bg-white/15" : "bg-gray-300"}`}
    >
      <span className={`inline-block h-[14px] w-[14px] rounded-full bg-white shadow transition-transform ${on ? "translate-x-[16px]" : "translate-x-[2px]"}`} />
    </button>
  );
}

// ── Formatting ───────────────────────────────────────────────────────────

export function formatBytes(bytes?: number) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
