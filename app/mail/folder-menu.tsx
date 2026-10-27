import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon, useTone } from "../entity/ui";
import { filterFlags, filterOf } from "../../lib/mail-filter";
import type { MailFilter, MailFolder } from "../mail-client";
import { GLYPHS, Glyph, Star } from "./glyphs";
import { useExit } from "./controls";

const FOLDER_GLYPH: Record<MailFolder, keyof typeof GLYPHS> = { active: "chats", inbox: "inbox", sent: "send", archive: "archive", other: "at" };

/**
 * Phones: one control for what the list shows, reading only what's chosen
 * ("In", "In · Unread · Starred"). Tapping it opens a glass sheet where you
 * pick a folder (Active, In, Out, Archive), switch Unread and Starred on or
 * off in any combination, and Apply. "Other" (mail to addresses nobody has)
 * is a desktop tab; it appears here only while you're in it.
 */
export function FolderMenu({ folders, folder, filter, count, onPick }: { folders: { key: MailFolder; label: string }[]; folder: MailFolder; filter: MailFilter; count: { unread: number; otherUnread: number } | null; onPick: (folder: MailFolder, filter: MailFilter) => void }) {
  const t = useTone();
  const [open, setOpen] = useState(false);
  const exit = useExit(open, 180);
  const wrap = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(0);
  // The sheet works on a draft; Apply makes it so.
  const flags = filterFlags(filter);
  const [dFolder, setDFolder] = useState<MailFolder>(folder);
  const [dUnread, setDUnread] = useState(flags.unread);
  const [dStarred, setDStarred] = useState(flags.starred);
  useEffect(() => {
    if (!open) return;
    setDFolder(folder);
    setDUnread(flags.unread);
    setDStarred(flags.starred);
    const measure = () => {
      const r = wrap.current?.getBoundingClientRect();
      if (r) setTop(r.bottom + 8);
    };
    measure();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    document.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
      document.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const n = (key: MailFolder) => (key === "inbox" || key === "active" ? count?.unread : key === "other" ? count?.otherUnread : 0) || 0;
  const shown = folders.filter((x) => x.key !== "other" || folder === "other");
  const cur = shown.find((x) => x.key === folder) ?? shown[0];
  const narrowed = flags.unread || flags.starred;
  const live = folder === "active" && !narrowed;
  const changed = dFolder !== folder || dUnread !== flags.unread || dStarred !== flags.starred;
  const apply = () => {
    onPick(dFolder, filterOf(dUnread, dStarred));
    setOpen(false);
  };
  const label = `text-[11px] font-semibold uppercase tracking-[0.14em] ${t.faint}`;
  const chip = `inline-flex items-center gap-1 rounded-full py-0.5 pl-1.5 pr-2 text-[12px] font-medium ${t.dark ? "bg-white/10 text-gray-100" : "bg-white text-gray-700 shadow-sm"}`;
  return (
    <div ref={wrap} className="flex min-w-0 flex-1 items-center">
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Showing ${cur.label}${flags.unread ? ", unread" : ""}${flags.starred ? ", starred" : ""}. Change folder or filters`}
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex h-[48px] w-full min-w-0 cursor-pointer items-center gap-2 rounded-full pl-5 pr-4 text-[15px] font-semibold transition-colors active:scale-[0.99] ${
          live ? `pill-glass-live ${t.dark ? "text-(--mail-accent-pale)" : "text-(--mail-accent-ink)"}` : `pill-glass ${t.dark ? "text-white" : "text-gray-900"}`
        }`}
      >
        <Glyph name={FOLDER_GLYPH[folder]} className="h-4 w-4" />
        <span className="truncate">{cur.label}</span>
        {!narrowed && n(folder) > 0 && <span className={`min-w-[20px] rounded-full px-1.5 text-center text-[11px] tabular-nums leading-5 ${live ? (t.dark ? "bg-(--mail-accent)/30 text-white" : "bg-(--mail-accent-deep) text-white") : t.dark ? "bg-white/15 text-white" : "bg-gray-900 text-white"}`}>{n(folder)}</span>}
        {flags.unread && (
          <span className={chip}>
            <span className="h-2 w-2 rounded-full bg-(--mail-accent)" />
            Unread
          </span>
        )}
        {flags.starred && (
          <span className={`${chip} ${t.dark ? "text-amber-200" : "text-amber-700"}`}>
            <Star on className="h-3 w-3" />
            Starred
          </span>
        )}
        <span className="flex-1" />
        <Icon name="chevronDown" className={`h-4 w-4 opacity-70 transition-transform ${open ? "rotate-180" : ""}`} strokeWidth={2.2} />
      </button>
      {exit.shown &&
        createPortal(
          <>
            <div className={`fixed inset-0 z-[64] bg-black/45 backdrop-blur-[2px] ${exit.leaving ? "backdrop-out" : "backdrop-in"}`} onClick={() => setOpen(false)} aria-hidden="true" />
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Folder and filters"
              style={{ position: "fixed", top, left: 12, width: "calc(100vw - 24px)" }}
              className={`${exit.leaving ? "menu-out" : "menu-down"} z-[65] overflow-hidden rounded-3xl border p-3 shadow-2xl mail-glass-top ${t.dark ? "border-white/10 bg-[#0f0f16]/85" : "border-gray-200 bg-white/90"}`}
            >
              <p className={`px-1.5 pb-2 pt-1 ${label}`}>Folder</p>
              <div className="grid grid-cols-2 gap-2">
                {shown.map((x) => {
                  const on = x.key === dFolder;
                  const isLive = x.key === "active";
                  const c = n(x.key);
                  const tone = on
                    ? isLive
                      ? t.dark ? "bg-(--mail-accent-deep)/30 text-(--mail-accent-pale) ring-1 ring-inset ring-(--mail-accent)/60" : "bg-(--mail-accent-deep) text-white"
                      : t.dark ? "bg-white/[0.12] text-white ring-1 ring-inset ring-white/15" : "bg-gray-900 text-white"
                    : t.dark ? "bg-white/[0.04] text-gray-200 hover:bg-white/[0.08]" : "bg-gray-50 text-gray-800 hover:bg-gray-100";
                  return (
                    <button
                      key={x.key}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      onClick={() => setDFolder(x.key)}
                      className={`flex h-[60px] cursor-pointer items-center gap-3 rounded-2xl px-3.5 text-left transition-colors active:scale-[0.98] ${isLive ? "col-span-2" : ""} ${tone}`}
                    >
                      <span className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${on ? "bg-white/15" : t.dark ? "bg-white/[0.06]" : "bg-white shadow-sm"}`}>
                        <Glyph name={FOLDER_GLYPH[x.key]} className="h-5 w-5" />
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[16px] font-semibold">{x.label}</span>
                      {c > 0 && <span className={`min-w-[22px] rounded-full px-1.5 text-center text-[12px] tabular-nums leading-[22px] ${on ? "bg-white/20" : t.dark ? "bg-(--mail-accent-deep)/25 text-(--mail-accent-pale)" : "bg-(--mail-accent-deep)/15 text-(--mail-accent-ink)"}`}>{c}</span>}
                      {on && <Icon name="check" className="h-4 w-4" strokeWidth={2.5} />}
                    </button>
                  );
                })}
              </div>
              <p className={`px-1.5 pb-2 pt-4 ${label}`}>Filters</p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  role="switch"
                  aria-checked={dUnread}
                  onClick={() => setDUnread((v) => !v)}
                  className={`flex h-[52px] cursor-pointer items-center gap-3 rounded-2xl px-3.5 text-left text-[15px] font-semibold transition-colors active:scale-[0.98] ${
                    dUnread
                      ? t.dark ? "bg-(--mail-accent-deep)/30 text-(--mail-accent-pale) ring-1 ring-inset ring-(--mail-accent)/60" : "bg-(--mail-accent-deep) text-white"
                      : t.dark ? "bg-white/[0.04] text-gray-200 ring-1 ring-inset ring-white/10" : "bg-gray-50 text-gray-800 ring-1 ring-inset ring-gray-200"
                  }`}
                >
                  <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${dUnread ? "bg-current" : "border-2 border-current opacity-60"}`} />
                  Unread
                  <span className="flex-1" />
                  <span className={`inline-flex h-5 w-5 items-center justify-center rounded-full ${dUnread ? "bg-white/25" : t.dark ? "bg-white/10" : "bg-white shadow-sm"}`}>{dUnread && <Icon name="check" className="h-3.5 w-3.5" strokeWidth={2.6} />}</span>
                </button>
                <button
                  type="button"
                  role="switch"
                  aria-checked={dStarred}
                  onClick={() => setDStarred((v) => !v)}
                  className={`flex h-[52px] cursor-pointer items-center gap-3 rounded-2xl px-3.5 text-left text-[15px] font-semibold transition-colors active:scale-[0.98] ${
                    dStarred
                      ? "bg-amber-400 text-gray-950"
                      : t.dark ? "bg-amber-400/10 text-amber-200 ring-1 ring-inset ring-amber-300/25" : "bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200"
                  }`}
                >
                  <Star on className="h-[18px] w-[18px] shrink-0" />
                  Starred
                  <span className="flex-1" />
                  <span className={`inline-flex h-5 w-5 items-center justify-center rounded-full ${dStarred ? "bg-white/40" : t.dark ? "bg-amber-400/15" : "bg-white shadow-sm"}`}>{dStarred && <Icon name="check" className="h-3.5 w-3.5" strokeWidth={2.6} />}</span>
                </button>
              </div>
              <div className="mt-3 flex items-center gap-2">
                {(dUnread || dStarred) && (
                  <button type="button" onClick={() => { setDUnread(false); setDStarred(false); }} className={`h-[48px] shrink-0 cursor-pointer rounded-2xl px-4 text-[14px] font-medium ${t.dark ? "text-gray-300 hover:bg-white/[0.06]" : "text-gray-600 hover:bg-gray-100"}`}>
                    Clear
                  </button>
                )}
                <button
                  type="button"
                  onClick={apply}
                  className={`fab-glass h-[48px] flex-1 cursor-pointer rounded-2xl text-[15px] font-semibold transition-transform active:scale-[0.98] ${changed ? "" : "opacity-80"}`}
                >
                  {changed ? "Apply" : "Done"}
                </button>
              </div>
            </div>
          </>,
          document.body,
        )}
    </div>
  );
}

