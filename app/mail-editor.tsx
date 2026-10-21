import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { cleanCompose, htmlFromPlain } from "../lib/mail-compose";
import { useTone } from "./entity/ui";

/**
 * The composer's body: formatted text (paragraphs, bold, italic, lists, quotes,
 * links) that keeps a paste's formatting, cleaned to what mail allows
 * (lib/mail-compose.ts). Plain-text pastes become paragraphs and lists.
 */

export type MailEditorHandle = {
  focus(atStart?: boolean): void;
  /** Replace the whole body (Improve design, Undo). */
  setHtml(html: string): void;
};

type Props = { initialHtml: string; onChange: (html: string) => void; placeholder?: string; className?: string };

export const MailEditor = forwardRef<MailEditorHandle, Props>(function MailEditor({ initialHtml, onChange, placeholder, className = "" }, ref) {
  const t = useTone();
  const el = useRef<HTMLDivElement>(null);
  const emit = () => onChange(el.current?.innerHTML ?? "");

  // Set once: React never re-renders the content (the caret would jump).
  useEffect(() => {
    if (el.current) el.current.innerHTML = initialHtml;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useImperativeHandle(ref, () => ({
    focus(atStart = false) {
      const node = el.current;
      if (!node) return;
      node.focus();
      if (atStart) {
        const range = document.createRange();
        range.setStart(node, 0);
        range.collapse(true);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
        node.scrollTop = 0;
      }
    },
    setHtml(html: string) {
      const node = el.current;
      if (!node) return;
      node.focus();
      // Through the editing command, so ⌘Z undoes it.
      document.execCommand("selectAll");
      if (!document.execCommand("insertHTML", false, html || "<p><br></p>")) node.innerHTML = html;
      emit();
    },
  }));

  function onPaste(e: React.ClipboardEvent<HTMLDivElement>) {
    const html = e.clipboardData.getData("text/html");
    const text = e.clipboardData.getData("text/plain");
    if (!html && !text) return; // files etc.: the browser's own handling
    e.preventDefault();
    const clean = html ? cleanCompose(html) : htmlFromPlain(text);
    document.execCommand("insertHTML", false, clean || htmlFromPlain(text));
    emit();
  }

  return (
    <div
      ref={el}
      role="textbox"
      aria-multiline="true"
      aria-label="Message"
      contentEditable
      suppressContentEditableWarning
      data-placeholder={placeholder}
      onInput={emit}
      onPaste={onPaste}
      onDrop={(e) => {
        // Dropped text goes through the same cleaning as a paste.
        const html = e.dataTransfer.getData("text/html");
        const text = e.dataTransfer.getData("text/plain");
        if (!html && !text) return;
        e.preventDefault();
        document.execCommand("insertHTML", false, html ? cleanCompose(html) : htmlFromPlain(text));
        emit();
      }}
      style={{ outline: "none" }}
      className={`overflow-y-auto px-4 py-3 text-[13.5px] leading-relaxed max-sm:text-[16px] ${t.text}
        empty:before:pointer-events-none empty:before:text-gray-500 empty:before:content-[attr(data-placeholder)]
        [&_p]:mb-3 [&_div]:min-h-[1.2em] [&_ol]:mb-3 [&_ol]:list-decimal [&_ol]:pl-6 [&_ul]:mb-3 [&_ul]:list-disc [&_ul]:pl-6 [&_li]:mb-1
        [&_blockquote]:mb-3 [&_blockquote]:border-l-2 [&_blockquote]:pl-3 ${t.dark ? "[&_blockquote]:border-white/15 [&_blockquote]:text-gray-400" : "[&_blockquote]:border-gray-300 [&_blockquote]:text-gray-600"}
        [&_h3]:mb-2 [&_h3]:mt-4 [&_h3]:text-[15px] [&_h3]:font-semibold [&_a]:underline ${t.dark ? "[&_a]:text-[#a5b4fc]" : "[&_a]:text-[#4f46e5]"} ${className}`}
    />
  );
});

/** Formatting buttons for the editor. mousedown is held so the selection stays in the body. */
export function FormatBar({ onFormat, disabled = false }: { onFormat: () => void; disabled?: boolean }) {
  const t = useTone();
  const run = (cmd: string, value?: string) => {
    document.execCommand(cmd, false, value);
    onFormat();
  };
  const btn = `inline-flex h-7 min-w-7 cursor-pointer items-center justify-center rounded-md px-1.5 text-[12.5px] transition-colors disabled:cursor-default disabled:opacity-40 max-sm:h-[40px] max-sm:min-w-[40px] ${
    t.dark ? "text-gray-400 hover:bg-white/[0.06] hover:text-white" : "text-gray-500 hover:bg-gray-100 hover:text-gray-900"
  }`;
  const items: { label: string; title: string; act: () => void; node: React.ReactNode }[] = [
    { label: "Bold", title: "Bold (⌘B)", act: () => run("bold"), node: <b>B</b> },
    { label: "Italic", title: "Italic (⌘I)", act: () => run("italic"), node: <i className="font-serif">I</i> },
    { label: "Bulleted list", title: "Bulleted list", act: () => run("insertUnorderedList"), node: <ListGlyph /> },
    { label: "Numbered list", title: "Numbered list", act: () => run("insertOrderedList"), node: <ListGlyph numbered /> },
    { label: "Quote", title: "Quote", act: () => run("formatBlock", "blockquote"), node: <span className="text-[15px] leading-none">“</span> },
    {
      label: "Link",
      title: "Link",
      act: () => {
        const url = window.prompt("Link address (https://…)", "https://");
        if (url && /^(https?:\/\/|mailto:)\S+$/i.test(url.trim())) run("createLink", url.trim());
      },
      node: <LinkGlyph />,
    },
    { label: "Clear formatting", title: "Clear formatting", act: () => run("removeFormat"), node: <span className="text-[11px] line-through">T</span> },
  ];
  return (
    <div className="flex items-center gap-0.5" role="toolbar" aria-label="Formatting">
      {items.map((it) => (
        <button key={it.label} type="button" aria-label={it.label} title={it.title} disabled={disabled} className={btn} onMouseDown={(e) => e.preventDefault()} onClick={it.act}>
          {it.node}
        </button>
      ))}
    </div>
  );
}

function ListGlyph({ numbered = false }: { numbered?: boolean }) {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden>
      {numbered ? (
        <>
          <text x="0.5" y="5.5" fontSize="5" fill="currentColor" stroke="none">1</text>
          <text x="0.5" y="12.5" fontSize="5" fill="currentColor" stroke="none">2</text>
        </>
      ) : (
        <>
          <circle cx="2" cy="4" r="1" fill="currentColor" stroke="none" />
          <circle cx="2" cy="11" r="1" fill="currentColor" stroke="none" />
        </>
      )}
      <path d="M6 4h9M6 11h9" strokeLinecap="round" />
    </svg>
  );
}

function LinkGlyph() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
    </svg>
  );
}
