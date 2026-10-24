import { FILE_KIND_LABEL, type FileKind } from "../lib/file-kind";

/**
 * A file's icon by kind (lib/file-kind.ts): a page with a folded corner in
 * the kind's colour, with a small mark inside that moves a little, so a row
 * with a PDF, a photo or a spreadsheet says so at a glance. The motion is
 * slow and quiet (app.css, .fi-*), staggered by `delay`, and off under
 * reduced motion.
 */

export const FILE_KIND_COLOR: Record<FileKind, string> = {
  pdf: "#ef4444",
  image: "#10b981",
  sheet: "#22c55e",
  doc: "#3b82f6",
  slides: "#f97316",
  archive: "#a855f7",
  audio: "#ec4899",
  video: "#8b5cf6",
  calendar: "#06b6d4",
  code: "#64748b",
  text: "#94a3b8",
  file: "#9ca3af",
};

export function FileIcon({ kind, className = "h-4 w-4", delay = 0, title }: { kind: FileKind; className?: string; /** ms, so icons side by side don't move in step */ delay?: number; title?: string }) {
  const c = FILE_KIND_COLOR[kind];
  const d = { animationDelay: `${delay}ms` };
  return (
    <svg viewBox="0 0 24 24" className={`fi fi-${kind} shrink-0 ${className}`} style={{ color: c }} aria-hidden={title ? undefined : true} role={title ? "img" : undefined}>
      {title && <title>{title}</title>}
      {/* The page and its folded corner. */}
      <path d="M6 2h8l5 5v13a2 2 0 01-2 2H6a2 2 0 01-2-2V4a2 2 0 012-2z" fill="currentColor" fillOpacity="0.16" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path className="fi-fold" d="M14 2v5h5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" style={d} />
      {kind === "pdf" && (
        <g className="fi-mark" style={d}>
          <rect x="3" y="12" width="14" height="6.5" rx="1.5" fill="currentColor" />
          <text x="10" y="17.2" textAnchor="middle" fontSize="5.2" fontWeight="800" fill="#fff" fontFamily="ui-sans-serif, system-ui, sans-serif" letterSpacing="0.2">
            PDF
          </text>
        </g>
      )}
      {kind === "image" && (
        <g className="fi-mark" style={d}>
          <circle className="fi-sun" cx="9" cy="11" r="1.6" fill="currentColor" />
          <path d="M6 18.5l3.2-3.6 2.3 2.4 2-2.2 3.5 3.4z" fill="currentColor" />
        </g>
      )}
      {kind === "sheet" && (
        <g className="fi-mark" fill="currentColor" style={d}>
          <rect className="fi-cell" x="7" y="11" width="3.2" height="2.2" rx="0.4" />
          <rect className="fi-cell" x="11" y="11" width="3.2" height="2.2" rx="0.4" style={{ animationDelay: `${delay + 300}ms` }} />
          <rect className="fi-cell" x="7" y="14.2" width="3.2" height="2.2" rx="0.4" style={{ animationDelay: `${delay + 600}ms` }} />
          <rect className="fi-cell" x="11" y="14.2" width="3.2" height="2.2" rx="0.4" style={{ animationDelay: `${delay + 900}ms` }} />
        </g>
      )}
      {(kind === "doc" || kind === "text") && (
        <g className="fi-mark" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" style={d}>
          <path className="fi-line" d="M7.5 11.5h7" />
          <path className="fi-line" d="M7.5 14.5h7" style={{ animationDelay: `${delay + 250}ms` }} />
          <path className="fi-line" d="M7.5 17.5h4.5" style={{ animationDelay: `${delay + 500}ms` }} />
        </g>
      )}
      {kind === "slides" && (
        <g className="fi-mark" fill="currentColor" style={d}>
          <rect className="fi-bar" x="7" y="14" width="2" height="4" rx="0.5" />
          <rect className="fi-bar" x="10.5" y="12" width="2" height="6" rx="0.5" style={{ animationDelay: `${delay + 200}ms` }} />
          <rect className="fi-bar" x="14" y="10" width="2" height="8" rx="0.5" style={{ animationDelay: `${delay + 400}ms` }} />
        </g>
      )}
      {kind === "archive" && (
        <g className="fi-mark" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" style={d}>
          <path className="fi-zip" d="M10 8v11" strokeDasharray="1.6 1.6" />
        </g>
      )}
      {kind === "audio" && (
        <g className="fi-mark" fill="currentColor" style={d}>
          <rect className="fi-wave" x="7" y="12" width="1.8" height="6" rx="0.9" />
          <rect className="fi-wave" x="10.1" y="10" width="1.8" height="8" rx="0.9" style={{ animationDelay: `${delay + 150}ms` }} />
          <rect className="fi-wave" x="13.2" y="13" width="1.8" height="5" rx="0.9" style={{ animationDelay: `${delay + 300}ms` }} />
        </g>
      )}
      {kind === "video" && (
        <g className="fi-mark" style={d}>
          <path className="fi-play" d="M9 10.5v7l6-3.5z" fill="currentColor" />
        </g>
      )}
      {kind === "calendar" && (
        <g className="fi-mark" style={d}>
          <rect x="6.5" y="10" width="9" height="8" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
          <path d="M6.5 12.8h9" stroke="currentColor" strokeWidth="1.4" />
          <circle className="fi-day" cx="12" cy="15.5" r="1.1" fill="currentColor" />
        </g>
      )}
      {kind === "code" && (
        <g className="fi-mark" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={d}>
          <path className="fi-bracket" d="M9 11.5l-2.5 2.8 2.5 2.8" />
          <path className="fi-bracket" d="M13 11.5l2.5 2.8-2.5 2.8" style={{ animationDelay: `${delay + 600}ms` }} />
        </g>
      )}
      {kind === "file" && (
        <g className="fi-mark" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" style={d}>
          <path d="M7.5 13h7" />
          <path d="M7.5 16h5" />
        </g>
      )}
    </svg>
  );
}

/** A row's attachments as icons: up to `max` kinds, then "+n". */
export function FileKindIcons({ kinds, count, className = "h-3.5 w-3.5", max = 2 }: { kinds: FileKind[]; count: number; className?: string; max?: number }) {
  const shown = kinds.slice(0, max);
  const more = count - shown.length;
  return (
    <span className="inline-flex items-center gap-0.5" title={`${count} attachment${count === 1 ? "" : "s"}: ${kinds.map((k) => FILE_KIND_LABEL[k]).join(", ")}`}>
      {shown.map((k, i) => (
        <FileIcon key={k} kind={k} className={className} delay={i * 400} />
      ))}
      {more > 0 && <span className="text-[10px] font-semibold tabular-nums opacity-70">+{more}</span>}
      <span className="sr-only">
        {count} attachment{count === 1 ? "" : "s"}
      </span>
    </span>
  );
}
