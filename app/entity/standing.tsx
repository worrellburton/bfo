/**
 * The first card on an entity's Overview: what it needs, right now, to be in
 * compliance, and nothing else. One line each, worst first, each opening
 * where it's put right. When nothing is needed, the card says so and names
 * the next filing.
 */

import { isPartner } from "../auth";
import { entityAddresses } from "../entity-addresses";
import { priceSuffix, stateRecordCents } from "../../lib/palm-pricing";
import { sameAddressText, stateFindings } from "../palm";
import { f8822bData, stateAddressStep } from "../paperwork-generate";
import { useEntity } from "./context";
import { fmtDate, type Asset } from "./model";
import { Icon, Rows, Section, TextButton, toneText, useTone, type Tone } from "./ui";

/** Calendar days from today to an ISO date, in local time. */
export function daysUntil(iso: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return Math.round((Date.parse(iso) - Date.now()) / 86400000);
  const due = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((due.getTime() - today.getTime()) / 86400000);
}

/** After an address change, how many places still have the old one (the Addresses card lists them). */
export function addressChangeRemaining(asset: Asset): number {
  if (!asset.previousAddress) return 0;
  const done = asset.addressUpdates ?? {};
  const step = stateAddressStep(asset.state, asset.type);
  const rec = asset.stateRecord;
  const stateMatches = !!rec?.address && sameAddressText(rec.address, asset.address);
  const stateDone = !step.needed || !!done.state || stateMatches;
  const irsDone = !f8822bData(asset).ein || !!done.irs;
  const w9Old = !!asset.w9 && (!asset.addressChangedAt || (asset.w9.uploadedAt ?? 0) < Date.parse(asset.addressChangedAt));
  return [!stateDone, !irsDone, w9Old, !done.banks].filter(Boolean).length;
}

type Need = { key: string; text: string; tone: Tone; when?: string; go: () => void };

const SOON_DAYS = 45;
const SHOWN = 5;

export function Standing() {
  const { page, view, asset, goToTab } = useEntity();
  const t = useTone();
  if (isPartner()) return null;

  const toAddresses = () => document.getElementById("addresses")?.scrollIntoView({ behavior: "smooth", block: "start" });
  const toCompliance = () => goToTab("compliance");
  const needs: Need[] = [];

  // The state's own word, read through Palm.
  const rec = asset.stateRecord;
  if (rec) for (const f of stateFindings(rec, asset)) if (f.tone === "bad") needs.push({ key: `state:${f.text}`, text: f.text, tone: "bad", go: toCompliance });

  // Filings overdue or due soon.
  for (const d of view.deadlines) {
    const days = d.due ? daysUntil(d.due) : null;
    if (days == null || days > SOON_DAYS) continue;
    needs.push({
      key: d.key,
      text: d.title.replace(/ \(overdue\)$/, ""),
      tone: days < 0 ? "bad" : "warn",
      when: days === 0 ? "today" : days === 1 ? "tomorrow" : days < 0 ? `${-days} days late` : `in ${days} days`,
      go: toCompliance,
    });
  }

  // Where the records break a rule.
  for (const i of view.issues) if (i.severity === "high") needs.push({ key: i.key, text: i.title, tone: "bad", go: toCompliance });

  // An address, or an agent, the law requires and the record lacks.
  if (!view.isTrust) for (const g of entityAddresses(asset).gaps) if (g.tone === "bad") needs.push({ key: `addr:${g.where}`, text: `${g.where}: ${g.text}`, tone: "bad", go: toAddresses });

  // After a move, who still has the old address.
  const moved = addressChangeRemaining(asset);
  if (moved) needs.push({ key: "address-change", text: `New address still to give to ${moved} ${moved === 1 ? "place" : "places"}`, tone: "warn", go: toAddresses });

  // Worst first, no repeats.
  const rank: Record<Tone, number> = { bad: 0, warn: 1, accent: 2, muted: 3, good: 4 };
  const seen = new Set<string>();
  const list = needs.filter((n) => (seen.has(n.text) ? false : (seen.add(n.text), true))).sort((a, b) => rank[a.tone] - rank[b.tone]);
  const shown = list.slice(0, SHOWN);
  const more = list.length - shown.length;

  // The next filing ahead, for the foot.
  const next = view.deadlines
    .filter((d) => d.due && daysUntil(d.due) > SOON_DAYS)
    .sort((a, b) => String(a.due).localeCompare(String(b.due)))[0];
  const unread = !view.isTrust && !rec;
  const good = list.length === 0;
  const dot = good ? "bg-emerald-400" : list.some((n) => n.tone === "bad") ? "bg-red-400" : "bg-amber-400";

  return (
    <Section
      title="Compliance"
      count={list.length || undefined}
      alert={list.length > 0}
      actions={
        <span className={`inline-flex items-center gap-2 text-[12.5px] ${good ? toneText("good", t.dark) : t.muted}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${dot}`} aria-hidden />
          {good ? (unread ? "Nothing needed on record" : "In good standing") : `${list.length} needed`}
        </span>
      }
    >
      <Rows>
        {shown.map((n) => (
          <button
            key={n.key}
            type="button"
            onClick={n.go}
            className={`flex w-full cursor-pointer items-center gap-3 px-5 py-3 text-left text-[13px] transition-colors max-sm:min-h-[44px] ${t.text} ${t.hover}`}
          >
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${n.tone === "bad" ? "bg-red-400" : "bg-amber-400"}`} aria-hidden />
            <span className="min-w-0 flex-1 leading-snug">{n.text}</span>
            {n.when && <span className={`shrink-0 text-[12px] tabular-nums ${toneText(n.tone === "bad" ? "bad" : "warn", t.dark)}`}>{n.when}</span>}
            <Icon name="chevronRight" className={`h-3 w-3 shrink-0 ${t.faint}`} />
          </button>
        ))}
        {more > 0 && (
          <button type="button" onClick={toCompliance} className={`flex w-full cursor-pointer items-center gap-3 px-5 py-2.5 text-left text-[12.5px] ${t.muted} ${t.hover}`}>
            {more} more in Compliance
            <Icon name="chevronRight" className={`h-3 w-3 ${t.faint}`} />
          </button>
        )}
        {good && (
          <div className={`px-5 py-3 text-[13px] ${t.text}`}>
            Nothing needed{next?.due ? <span className={t.muted}>. Next: {next.title}, {fmtDate(next.due)}.</span> : "."}
          </div>
        )}
        {unread && (
          <div className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-5 py-2.5 text-[12.5px] ${t.muted}`}>
            <span>The state's record hasn't been read yet.</span>
            <TextButton onClick={() => void page.checkStateRecord()} disabled={!!page.palmBusy}>
              {page.palmBusy === "record" ? "Checking…" : `Check state record${priceSuffix(page.palmMode, stateRecordCents(!!asset.fileNumber))}`}
            </TextButton>
          </div>
        )}
      </Rows>
    </Section>
  );
}
