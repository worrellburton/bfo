import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { cleanCompose, htmlFromPlain } from "../lib/mail-compose";
import { Button, Dialog, Field, Input, cx } from "./ui";
import { GlyphButton, type GlyphName } from "./mail/glyphs";

/**
 * The composer's body: formatted text (paragraphs, bold, italic, lists, quotes,
 * links) that keeps a paste's formatting, cleaned to what mail allows
 * (lib/mail-compose.ts). Plain-text pastes become paragraphs and lists. Text
 * at the field size (14 desktop, 16 touch, so iOS never zooms), the
 * placeholder in ink-3, and the global focus ring left off: the caret is the
 * focus in a page-sized writing area.
 */

export type MailEditorHandle = {
  focus(atStart?: boolean): void;
  /** Replace the whole body (Tidy layout, Undo). */
  setHtml(html: string): void;
};

type Props = { initialHtml: string; onChange: (html: string) => void; placeholder?: string; className?: string; label?: string };

export const MailEditor = forwardRef<MailEditorHandle, Props>(function MailEditor({ initialHtml, onChange, placeholder, className, label = "Message" }, ref) {
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
      aria-label={label}
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
      className={cx(
        "overflow-y-auto text-field text-ink outline-none!",
        "empty:before:pointer-events-none empty:before:text-ink-3 empty:before:content-[attr(data-placeholder)]",
        "[&_p]:mb-3 [&_div]:min-h-[1.2em] [&_ol]:mb-3 [&_ol]:list-decimal [&_ol]:pl-6 [&_ul]:mb-3 [&_ul]:list-disc [&_ul]:pl-6 [&_li]:mb-1",
        "[&_blockquote]:mb-3 [&_blockquote]:border-l-2 [&_blockquote]:border-line-strong [&_blockquote]:pl-3 [&_blockquote]:text-ink-2",
        "[&_a]:text-accent [&_a]:underline",
        className,
      )}
    />
  );
});

/** Formatting for the editor: one icon set, one size. mousedown is held so the selection stays in the body. */
export function FormatBar({ onFormat, disabled = false }: { onFormat: () => void; disabled?: boolean }) {
  const run = (cmd: string, value?: string) => {
    document.execCommand(cmd, false, value);
    onFormat();
  };
  // A link: the selection is kept while its address is asked for, then the link goes on it.
  const saved = useRef<Range | null>(null);
  const [asking, setAsking] = useState(false);
  const [url, setUrl] = useState("https://");
  const okUrl = /^(https?:\/\/[^\s.]+\.\S+|mailto:\S+@\S+)$/i.test(url.trim());
  function addLink() {
    const range = saved.current;
    setAsking(false);
    if (!okUrl || !range) return;
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    run("createLink", url.trim());
  }
  const items: { label: string; glyph: GlyphName; act: () => void }[] = [
    { label: "Bold (⌘B)", glyph: "bold", act: () => run("bold") },
    { label: "Italic (⌘I)", glyph: "italic", act: () => run("italic") },
    { label: "Bulleted list", glyph: "bullets", act: () => run("insertUnorderedList") },
    { label: "Numbered list", glyph: "numbers", act: () => run("insertOrderedList") },
    { label: "Quote", glyph: "quote", act: () => run("formatBlock", "blockquote") },
    {
      label: "Link",
      glyph: "link",
      act: () => {
        const sel = window.getSelection();
        saved.current = sel && sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
        setUrl("https://");
        setAsking(true);
      },
    },
    { label: "Clear formatting", glyph: "clearFormat", act: () => run("removeFormat") },
  ];
  return (
    <div className="flex items-center gap-1" role="toolbar" aria-label="Formatting">
      {items.map((it) => (
        <GlyphButton key={it.label} glyph={it.glyph} label={it.label} disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={it.act} />
      ))}
      <Dialog
        open={asking}
        onClose={() => setAsking(false)}
        title="Add a link"
        description="On the words you selected."
        size="sm"
        footer={
          <>
            <Button onClick={() => setAsking(false)}>Cancel</Button>
            <Button variant="primary" disabled={!okUrl} disabledReason="Type a web or email address" onClick={addLink}>
              Add link
            </Button>
          </>
        }
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            addLink();
          }}
        >
          <Field label="Address" hint="A web address (https://…) or mailto:">
            <Input value={url} onChange={(e) => setUrl(e.target.value)} inputMode="url" autoCapitalize="none" spellCheck={false} />
          </Field>
        </form>
      </Dialog>
    </div>
  );
}
