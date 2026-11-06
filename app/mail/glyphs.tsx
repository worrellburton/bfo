import { Tooltip, cx } from "../ui";

/**
 * Mail's own glyphs (reply, forward, archive, star…), drawn exactly like the
 * system's icon set (app/ui/icon.tsx: outline, stroke 1.75, sized by --icon,
 * currentColor) until the set gains them. GlyphButton is the system's
 * IconButton with one of these.
 */
export const GLYPHS = {
  reply: "M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3",
  replyAll: "M7.5 15l-6-6 6-6M12 15L6 9l6-6M6 9h8.25a6 6 0 010 12H13.5",
  forward: "M15 15l6-6m0 0l-6-6m6 6H9a6 6 0 000 12h3",
  archive:
    "M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z",
  unarchive:
    "M2.25 13.5h3.86a2.25 2.25 0 012.012 1.244l.256.512a2.25 2.25 0 002.013 1.244h3.218a2.25 2.25 0 002.013-1.244l.256-.512a2.25 2.25 0 012.013-1.244h3.859M2.25 13.838V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18v-4.162c0-.224-.034-.447-.1-.661L19.24 5.338a2.25 2.25 0 00-2.15-1.588H6.911a2.25 2.25 0 00-2.15 1.588L2.35 13.177a2.25 2.25 0 00-.1.661z",
  restore: "M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3",
  clip: "M18.375 12.739l-7.693 7.693a4.5 4.5 0 01-6.364-6.364l10.94-10.94A3 3 0 1119.5 7.372L8.552 18.32m.009-.01l-.01.01m5.699-9.941l-7.81 7.81a1.5 1.5 0 002.112 2.13",
  star: "M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z",
  rows: "M3.75 5.25h16.5M3.75 9.75h16.5M3.75 14.25h16.5M3.75 18.75h16.5",
  columns: "M9 4.5v15m6-15v15M3 6.75A2.25 2.25 0 015.25 4.5h13.5A2.25 2.25 0 0121 6.75v10.5a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 17.25V6.75z",
  chats:
    "M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193-.34.027-.68.052-1.02.072v3.091l-3-3c-1.354 0-2.694-.055-4.02-.163a2.115 2.115 0 01-.825-.242m9.345-8.334a2.126 2.126 0 00-.476-.095 48.64 48.64 0 00-8.048 0c-1.131.094-1.976 1.057-1.976 2.192v4.286c0 .837.46 1.58 1.155 1.951m9.345-8.334V6.637c0-1.621-1.152-3.026-2.76-3.235A48.455 48.455 0 0011.25 3c-2.115 0-4.198.137-6.24.402-1.608.209-2.76 1.614-2.76 3.235v6.226c0 1.621 1.152 3.026 2.76 3.235.577.075 1.157.14 1.74.194V21l4.155-4.155",
  inbox:
    "M9 3.75H6.912a2.25 2.25 0 00-2.15 1.588L2.35 13.177a2.25 2.25 0 00-.1.661V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18v-4.162c0-.224-.034-.447-.1-.661L19.24 5.338a2.25 2.25 0 00-2.15-1.588H15M2.25 13.5h3.86a2.25 2.25 0 012.012 1.244l.256.512a2.25 2.25 0 002.013 1.244h3.218a2.25 2.25 0 002.013-1.244l.256-.512a2.25 2.25 0 012.013-1.244h3.859M12 3v8.25m0 0l-3-3m3 3l3-3",
  send: "M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5",
  at: "M16.5 12a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0zm0 0c0 1.657 1.007 3 2.25 3S21 13.657 21 12a9 9 0 10-2.636 6.364",
  unread:
    "M21.75 9v.906a2.25 2.25 0 01-1.183 1.981l-6.478 3.488M2.25 9v.906a2.25 2.25 0 001.183 1.981l6.478 3.488m8.839 2.51l-4.66-2.51m0 0l-1.023-.55a2.25 2.25 0 00-2.134 0l-1.022.55m0 0l-4.661 2.51m16.5 1.615a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V8.844a2.25 2.25 0 011.183-1.981l7.5-4.039a2.25 2.25 0 012.134 0l7.5 4.039a2.25 2.25 0 011.183 1.98V19.5z",
  trash: "M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M4 7h16M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3",
  compose:
    "M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10",
  bold: "M7 5h6a3.5 3.5 0 010 7H7zm0 7h7a3.5 3.5 0 010 7H7z",
  italic: "M10 5h8M6 19h8M14 5l-4 14",
  bullets: "M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01",
  numbers: "M10 6h10M10 12h10M10 18h10M4 4.5h1.5V9M4 9h3M4 13.5c.5-.7 2.5-.9 2.6.5.1 1.1-2.6 2-2.6 3.5h3",
  quote: "M7 7h4v4c0 3-1.5 5-4 6m6-10h4v4c0 3-1.5 5-4 6",
  link: "M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1",
  clearFormat: "M6 5h12M12 5l-3 14M4 4l16 16",
  letters: "M3 18l4.5-12h1L13 18M4.6 14h6.8M15 13.5c.6-.9 1.6-1.4 2.7-1.4 1.6 0 2.8 1 2.8 2.6V18m0-3.2c-.9-.4-1.8-.6-2.7-.6-1.4 0-2.8.6-2.8 1.9 0 1.2 1 1.9 2.2 1.9 1.4 0 2.6-.8 3.3-2",
} as const;

export type GlyphName = keyof typeof GLYPHS;

/** A glyph at the system's icon size (16 desktop, 20 touch) unless `size` fixes it. */
export function Glyph({ name, size, className }: { name: GlyphName; size?: 16 | 20; className?: string }) {
  const box = size === 16 ? "size-[16px]" : size === 20 ? "size-[20px]" : "size-(--icon)";
  return (
    <svg className={cx("shrink-0", box, className)} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.75} aria-hidden="true" focusable="false">
      <path strokeLinecap="round" strokeLinejoin="round" d={GLYPHS[name]} />
    </svg>
  );
}

/** The system's IconButton (32px desktop, 44px touch, quiet, a tooltip on desktop) with one of Mail's glyphs. */
export function GlyphButton({
  glyph,
  icon,
  label,
  pressed,
  danger = false,
  noTooltip = false,
  className,
  type = "button",
  ...rest
}: {
  glyph: GlyphName;
  /** Drawn instead of the glyph (the filled star). */ icon?: React.ReactNode;
  label: string;
  pressed?: boolean;
  danger?: boolean;
  noTooltip?: boolean;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const button = (
    <button
      type={type}
      aria-label={label}
      aria-pressed={pressed}
      className={cx(
        "ds relative inline-flex size-(--control-sm) shrink-0 cursor-pointer items-center justify-center rounded-control transition-colors duration-(--dur-1) disabled:cursor-not-allowed disabled:text-ink-disabled",
        pressed ? "bg-selected text-ink" : "enabled:hover:bg-hover enabled:active:bg-selected",
        danger ? "text-ink-2 enabled:hover:text-negative" : "text-ink-2 enabled:hover:text-ink",
        className,
      )}
      {...rest}
    >
      {icon ?? <Glyph name={glyph} />}
    </button>
  );
  return noTooltip ? button : <Tooltip label={label}>{button}</Tooltip>;
}

/** The star: an outline, filled amber when on (amber lives on the glyph only). */
export function Star({ on, size, className }: { on: boolean; size?: 16 | 20; className?: string }) {
  const box = size === 16 ? "size-[16px]" : size === 20 ? "size-[20px]" : "size-(--icon)";
  return (
    <svg
      className={cx("shrink-0", box, on && "text-warning", className)}
      viewBox="0 0 24 24"
      fill={on ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={1.75}
      aria-hidden="true"
      focusable="false"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d={GLYPHS.star} />
    </svg>
  );
}
