import type { Dispatch, SetStateAction } from "react";
import { Link } from "react-router";
import { isAdmin, type User } from "../auth";
import { Button, Icon, useTone } from "../entity/ui";
import type { MailCount, MailFaces } from "../mail-client";
import { Glyph } from "./glyphs";
import type { View } from "./constants";
import { SearchField, Segmented, ThemeButton } from "./controls";
import { MailboxPicker } from "./mailbox-picker";
import { MyPhoto } from "./my-photo";
import { blankDraft, type Draft } from "./drafts";

/**
 * The top of the page. Phones: the way back to BFO and the appearance switch,
 * then the mailbox as the title (it shrinks into a glass bar as the list
 * scrolls). Larger screens: the title, the addresses, search and the view
 * switch on one line.
 */
export function MailHeader({ openId, me, address, noAddress, aliases, box, chooseBox, scrolled, count, toggleMailTheme, setFaces, q, search, view, chooseView, setDraft }: {
  openId: string | null;
  me: User | null;
  address: string;
  noAddress: boolean;
  aliases: string[];
  box: string;
  chooseBox: (next: string) => void;
  scrolled: boolean;
  count: MailCount | null;
  toggleMailTheme: () => void;
  setFaces: Dispatch<SetStateAction<MailFaces>>;
  q: string;
  search: (term: string) => void;
  view: View;
  chooseView: (next: View) => void;
  setDraft: Dispatch<SetStateAction<Draft | null>>;
}) {
  const t = useTone();
  return (
    <>
      {/* Phones: Mail is its own place. A way back to BFO, then the mailbox as the title, the way out to its menu. */}
      {!openId && (
        <div className="flex items-center gap-2 px-1 pt-1 md:hidden">
          <Link
            to="/home"
            aria-label="Back to BFO"
            className={`inline-flex h-[44px] shrink-0 items-center gap-1 rounded-full pl-1.5 pr-3 text-[13px] font-medium transition-colors ${t.dark ? "text-gray-400 hover:bg-white/[0.06] hover:text-white" : "text-gray-500 hover:bg-gray-100 hover:text-gray-900"}`}
          >
            <Icon name="chevronLeft" className="h-4 w-4" strokeWidth={2.2} />
            BFO
          </Link>
          <span className="flex-1" />
          {/* Your own photo is set from the desktop header; on a phone its menu had no room. */}
          <ThemeButton dark={t.dark} onToggle={toggleMailTheme} className={`pill-glass h-[44px] w-[44px] ${t.dark ? "text-gray-100" : "text-gray-700"}`} iconClassName="h-[22px] w-[22px]" />
        </div>
      )}
      {!openId && address && !noAddress && (
        <div className={`sticky z-20 -mx-4 px-5 transition-[padding,background-color] duration-300 md:hidden ${scrolled ? `mail-glass-top border-b py-2 ${t.dark ? "border-white/[0.08] bg-[#0b0b10]/[0.92]" : "border-gray-200 bg-white/[0.92]"}` : "px-5 py-0"}`} style={{ top: "env(safe-area-inset-top)" }}>
          <MailboxPicker address={address} aliases={aliases} box={box} onChoose={chooseBox} canAdd={isAdmin(me)} big compact={scrolled} unread={count?.unread ?? 0} />
        </div>
      )}
      {!openId && noAddress && <p className={`px-2 text-[13px] md:hidden ${t.muted}`}>No address yet. Ask an admin for one.</p>}
      {/* Larger screens: the title, the addresses, search and the view switch on one line. */}
      <header className="flex items-start justify-between gap-3 pt-1 max-md:hidden">
        <div className="flex min-w-0 items-center gap-3">
          {address && !noAddress && <MyPhoto address={address} name={me?.name ?? null} onFaces={setFaces} />}
          <div className="min-w-0">
            <h1 className={`text-[20px] font-semibold leading-[1.2] tracking-[-0.015em] sm:text-[22px] ${t.text}`}>Mail</h1>
            {noAddress ? (
              <p className={`mt-1 text-[12.5px] ${t.muted}`}>No address yet</p>
            ) : address && (
              <MailboxPicker address={address} aliases={aliases} box={box} onChoose={chooseBox} canAdd={isAdmin(me)} />
            )}
          </div>
        </div>
        <SearchField value={q} onSearch={search} className="mx-6 hidden min-w-0 max-w-[460px] flex-1 self-center md:flex" />
        <div className="flex shrink-0 items-center gap-2">
          <ThemeButton dark={t.dark} onToggle={toggleMailTheme} className={`h-8 w-8 ${t.dark ? "text-gray-400 hover:bg-white/[0.06] hover:text-white" : "text-gray-500 hover:bg-gray-100 hover:text-gray-900"}`} />
          <Segmented
            label="View"
            value={view}
            onChange={chooseView}
            iconsOnly
            className="max-md:hidden"
            options={[
              { key: "table", label: "Table", icon: <Glyph name="rows" className="h-3.5 w-3.5" /> },
              { key: "columns", label: "Columns", icon: <Glyph name="columns" className="h-3.5 w-3.5" /> },
            ]}
          />
          <Button kind="primary" size="md" icon="edit" disabled={noAddress} title={noAddress ? "Ask an admin for an address" : undefined} onClick={() => setDraft(blankDraft(box || undefined))} className="max-sm:hidden">
            New
          </Button>
        </div>
      </header>
    </>
  );
}
