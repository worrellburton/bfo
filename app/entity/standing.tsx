/**
 * The first card on an entity's Overview: what it needs, right now, to be in
 * compliance, and nothing else. When the state's record shows it behind, the
 * card says whose record it is and when it was read, which filing is
 * presumed missed, how late, the late fees, what happens if it stays unfiled,
 * and carries the page's one primary action: file it. Everything else is a
 * line each, worst first, each opening where it's put right.
 */

import { isPartner } from "../auth";
import { entityAddresses } from "../entity-addresses";
import { priceSuffix, stateRecordCents } from "../../lib/palm-pricing";
import { effectiveRecord, recordLapsed, sameAddressText, stateFindings } from "../palm";
import { f8822bData, stateAddressStep } from "../paperwork-generate";
import { stateCode, stateName, type Obligation } from "../entity-paperwork";
import { Button, Card, List, ListRow, TextLink, buttonClasses, cx, format } from "../ui";
import { useEntity } from "./context";
import type { Asset } from "./model";

/** Calendar days from today to an ISO date, in local time. */
function daysUntil(iso: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return Math.round((Date.parse(iso) - Date.now()) / 86400000);
  const due = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((due.getTime() - today.getTime()) / 86400000);
}

/** After an address change, how many places still have the old one (the New address card lists them). */
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

type Need = { key: string; text: string; tone: "bad" | "warn"; when?: string; go: () => void };

const SOON_DAYS = 45;
const SHOWN = 5;

/** "2026 Nevada Annual List" from a rule-book title and a period label. */
const filingName = (o: Obligation) => `${o.last?.label ? `${o.last.label} ` : ""}${o.title.split(" + ")[0]}`;

export function Standing() {
  const { page, view, asset, goToTab } = useEntity();
  if (isPartner()) return null;

  const toAddresses = () => document.getElementById("addresses")?.scrollIntoView({ behavior: "smooth", block: "start" });
  const toCompliance = () => goToTab("compliance");
  const where = stateName(stateCode(asset.state) ?? "") || "The state";

  // The state's own word, read through Palm, and the filing it presumably means.
  const rec = asset.stateRecord ? effectiveRecord(asset.stateRecord, asset.stateConfirmed) : null;
  const behind = !!rec && recordLapsed(rec);
  const missed = behind ? view.deadlines.find((d) => d.key === "state-annual" || (d.overdue && /annual|report|list|franchise/i.test(d.title))) : undefined;
  const late = missed?.last && missed.last.status !== "filed" ? missed.last : null;
  const lateDays = late?.daysLate ?? (late?.due ? -daysUntil(late.due) : null);

  const needs: Need[] = [];
  if (asset.stateRecord)
    for (const f of stateFindings(asset.stateRecord, asset)) {
      if (f.tone !== "bad") continue;
      // The lead says this one, with its source and the filing.
      if (behind && /good standing|not active/i.test(f.text)) continue;
      needs.push({ key: `state:${f.text}`, text: f.text, tone: "bad", go: toCompliance });
    }
  for (const d of view.deadlines) {
    if (d === missed || d.conditional) continue;
    const days = d.due ? daysUntil(d.due) : null;
    if (days == null || (days > SOON_DAYS && !d.overdue)) continue;
    needs.push({
      key: d.key,
      text: d.title.replace(/ \(overdue\)$/, ""),
      tone: days < 0 || d.overdue ? "bad" : "warn",
      when: days === 0 ? "today" : days === 1 ? "tomorrow" : days < 0 ? `${-days} days late` : `in ${days} days`,
      go: toCompliance,
    });
  }
  for (const i of view.issues) if (i.severity === "high") needs.push({ key: i.key, text: i.title, tone: "bad", go: toCompliance });
  if (!view.isTrust) for (const g of entityAddresses(asset).gaps) if (g.tone === "bad") needs.push({ key: `addr:${g.where}`, text: `${g.where}: ${g.text}`, tone: "bad", go: toAddresses });

  // Worst first, no repeats.
  const seen = new Set<string>();
  const list = needs.filter((n) => (seen.has(n.text) ? false : (seen.add(n.text), true))).sort((a, b) => Number(a.tone === "warn") - Number(b.tone === "warn"));
  const shown = list.slice(0, SHOWN);
  const more = list.length - shown.length;
  const count = list.length + (behind ? 1 : 0);

  const next = view.deadlines.filter((d) => d.due && daysUntil(d.due) > SOON_DAYS && !d.conditional).sort((a, b) => String(a.due).localeCompare(String(b.due)))[0];
  const unread = !view.isTrust && !asset.stateRecord;
  const readOn = asset.stateRecord ? format.date(new Date(asset.stateRecord.checkedAt), "medium") : "";
  const price = priceSuffix(page.palmMode, stateRecordCents(!!asset.fileNumber));

  return (
    <Card title="Compliance" flush>
      {behind && (
        <div className="flex flex-col gap-3 px-5 pt-1 pb-4 touch:px-4">
          <p className="flex items-start gap-2 text-body text-ink">
            <span aria-hidden="true" className="mt-[7px] size-2 shrink-0 rounded-full bg-negative" />
            <span className="min-w-0 text-pretty">
              <span className="font-medium">Not in good standing.</span> {where}’s record, read through Palm {readOn}, shows {rec?.status && rec.status !== "active" ? `it ${rec.status}` : "its filings behind"}.
              {late && missed && (
                <>
                  {" "}
                  The {filingName(missed)}, due {format.date(late.due, "medium")}, looks outstanding{lateDays && lateDays > 0 ? `: ${lateDays} days late` : ""}.
                </>
              )}
            </span>
          </p>
          {missed && (missed.lateFee || missed.consequence) && (
            <p className="max-w-[68ch] pl-4 text-small text-pretty text-ink-2">
              {missed.lateFee ? `Late fees: ${missed.lateFee}. ` : ""}
              {missed.consequence ?? ""}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pl-4">
            {missed?.url ? (
              <a href={missed.url} target="_blank" rel="noopener noreferrer" className={buttonClasses({ variant: "primary" })}>
                File the {filingName(missed)}
                <span className="sr-only">, opens the state’s site in a new tab</span>
              </a>
            ) : null}
            <TextLink to={page.tabPath("compliance")} onClick={(e) => (e.preventDefault(), toCompliance())}>
              Details and the record
            </TextLink>
          </div>
        </div>
      )}
      {shown.length > 0 && (
        <List label="What it needs" className={cx(behind && "border-t border-line")}>
          {shown.map((n) => (
            <ListRow
              key={n.key}
              leading={<span aria-hidden="true" className={cx("block size-2 rounded-full", n.tone === "bad" ? "bg-negative" : "bg-warning")} />}
              title={n.text}
              meta={n.when}
              onClick={n.go}
            />
          ))}
          {more > 0 && <ListRow title={<span className="text-ink-2">{more} more in Compliance</span>} onClick={toCompliance} />}
        </List>
      )}
      {!count && (
        <p className="px-5 pb-4 text-body text-ink-2 touch:px-4">
          {unread ? "Nothing needed on record." : "In good standing; nothing needed."}
          {next?.due ? ` Next: ${next.title}, ${format.date(next.due, "medium")}.` : ""}
        </p>
      )}
      {unread && (
        <div className={cx("flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-5 py-3 text-small text-ink-2 touch:px-4", (count > 0 || behind) && "border-t border-line")}>
          <span>The state’s record hasn’t been read yet.</span>
          {!asset.archived && (
            <span className="inline-flex items-center gap-2">
              <Button variant="quiet" size="sm" busy={page.palmBusy === "record"} busyLabel="Checking…" disabled={!!page.palmBusy} onClick={() => void page.checkStateRecord()} className="text-accent">
                Check the state’s record
              </Button>
              {price && <span className="text-ink-3">{price.replace(/^ · /, "")}</span>}
            </span>
          )}
        </div>
      )}
    </Card>
  );
}
