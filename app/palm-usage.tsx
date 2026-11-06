/**
 * What Palm has cost, estimated: BFO logs every billed call it makes
 * (lib/palm.ts) and prices it from Palm's list (lib/palm-pricing.ts). Palm's
 * own invoice is the bill; this is the estimate to reconcile it against. On
 * Tools → Entity compliance as one line, with the month by product, by
 * entity, the latest calls, the price list and the webhook's health in a
 * sheet.
 */

import { useEffect, useState } from "react";
import { PALM_PRICES, STATE_RECORD_CENTS, type PalmProduct } from "../lib/palm-pricing";
import { palmCall, type PalmMode } from "./palm";
import { Banner, Button, CardSection, format, Rows, Sheet, Skeleton } from "./ui";

type Usage = {
  mode: PalmMode | null;
  month: { cents: number; calls: number; testCalls: number; byProduct: Partial<Record<PalmProduct, { calls: number; cents: number }>> };
  lastMonth: { cents: number };
  recent: { at: string; mode: PalmMode; product: PalmProduct; cents: number; by: string | null; assetId: string | null; reason: string | null }[];
  /** Whether Palm's webhooks are reaching BFO (api/palm-webhook.ts). */
  webhook?: { lastAt: string | null; lastType: string | null; lastMode: string | null; weekCount: number; url: string };
};

const money = (cents: number) => format.money(cents / 100);

/** The month's billed calls, by entity (from the latest calls the server returns). */
function byEntity(u: Usage, names: Record<string, string>): { name: string; cents: number; calls: number }[] {
  const start = new Date();
  start.setDate(1);
  start.setHours(0, 0, 0, 0);
  const out = new Map<string, { name: string; cents: number; calls: number }>();
  for (const r of u.recent) {
    if (r.mode !== "live" || Date.parse(r.at) < start.getTime()) continue;
    const key = r.assetId ?? "";
    const row = out.get(key) ?? { name: (r.assetId && names[r.assetId]) || "No entity", cents: 0, calls: 0 };
    row.cents += r.cents;
    row.calls++;
    out.set(key, row);
  }
  return [...out.values()].sort((a, b) => b.cents - a.cents);
}

/** "Palm, estimated this month: $4.62 · Details". `refreshKey` re-reads after a billed check. */
export function PalmCostLine({ names, refreshKey = 0 }: { names: Record<string, string>; refreshKey?: number }) {
  const [usage, setUsage] = useState<Usage | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    palmCall<Usage>("usage")
      .then((u) => alive && (setUsage(u), setFailed(false)))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [refreshKey]);

  if (failed && !usage) return null;
  if (!usage?.month) return <Skeleton kind="line" className="w-[280px]" />;
  const month = new Date().toLocaleString("en-US", { month: "long" });
  const products = Object.entries(usage.month.byProduct ?? {}) as [PalmProduct, { calls: number; cents: number }][];
  const entities = byEntity(usage, names);
  const quiet = usage.webhook && !usage.webhook.lastAt;

  return (
    <>
      <p className="flex flex-wrap items-center gap-x-2 text-small text-ink-2">
        <span>
          Palm in {month}: <span className="text-ink tabular-nums">{money(usage.month.cents)}</span>, estimated from its list prices
        </span>
        <Button size="sm" variant="quiet" onClick={() => setOpen(true)}>
          Details
        </Button>
      </p>
      {quiet && (
        <Banner tone="warning" className="mt-2">
          Nothing has reached BFO from Palm's webhooks yet, so state mail and filing news won't arrive on their own. Details says where they must point.
        </Banner>
      )}
      <Sheet open={open} onClose={() => setOpen(false)} side="right" title={`Palm in ${month}`} description="An estimate from BFO's own log of billed calls and Palm's list prices. Palm's invoice is the bill: reconcile against it.">
        <div className="flex flex-col gap-6">
          <CardSection title="This month">
            <Rows>
              <Line label="Estimated so far" value={money(usage.month.cents)} />
              <Line label="Billed calls" value={String(usage.month.calls)} />
              {usage.month.testCalls > 0 && <Line label="Free calls in test mode" value={String(usage.month.testCalls)} />}
              <Line label="Last month" value={money(usage.lastMonth.cents)} />
            </Rows>
          </CardSection>
          {products.length > 0 && (
            <CardSection title="By product">
              <Rows>
                {products.map(([p, v]) => (
                  <Line key={p} label={`${PALM_PRICES[p]?.label ?? p} · ${v.calls} × ${money(PALM_PRICES[p]?.cents ?? 0)}`} value={money(v.cents)} />
                ))}
              </Rows>
            </CardSection>
          )}
          {entities.length > 0 && (
            <CardSection title="By entity, from the latest calls">
              <Rows>
                {entities.map((e) => (
                  <Line key={e.name} label={`${e.name} · ${format.count(e.calls, "call")}`} value={money(e.cents)} />
                ))}
              </Rows>
            </CardSection>
          )}
          <CardSection title="Latest calls">
            {!usage.recent.length ? (
              <p className="text-body text-ink-2">No billed calls yet.</p>
            ) : (
              <Rows>
                {usage.recent.slice(0, 12).map((r, i) => (
                  <div key={i} className="flex items-baseline gap-3 py-2">
                    <span className="min-w-0 flex-1">
                      <span className="block text-body text-ink">
                        {PALM_PRICES[r.product]?.label ?? r.product}
                        {r.assetId && names[r.assetId] ? ` · ${names[r.assetId]}` : ""}
                      </span>
                      <span className="block text-small text-ink-2">
                        {format.dateTime(r.at)}
                        {r.by ? ` · ${r.by}` : ""}
                      </span>
                    </span>
                    <span className="shrink-0 text-body text-ink tabular-nums">{r.mode === "test" ? "Test" : money(r.cents)}</span>
                  </div>
                ))}
              </Rows>
            )}
          </CardSection>
          {usage.webhook && (
            <CardSection title="Palm's webhooks">
              <p className="text-body text-ink">
                {usage.webhook.lastAt
                  ? `Last received ${format.dateTime(usage.webhook.lastAt)} (${usage.webhook.lastType ?? "an event"}${usage.webhook.lastMode === "test" ? ", test" : ""}); ${format.count(usage.webhook.weekCount, "event")} in the last 7 days.`
                  : "Nothing has reached BFO from Palm yet."}
              </p>
              <p className="mt-1 text-small break-all text-ink-2">
                In Palm Console, Webhooks must point at {usage.webhook.url}. The bare domain answers with a redirect, which Palm doesn't follow.
              </p>
            </CardSection>
          )}
          <CardSection title="Palm's prices">
            <Rows>
              {(Object.entries(PALM_PRICES) as [PalmProduct, (typeof PALM_PRICES)[PalmProduct]][]).map(([k, p]) => (
                <Line key={k} label={`${p.label}: ${p.what}`} value={`${money(p.cents)} ${p.per === "call" ? "a call" : "a month"}`} />
              ))}
            </Rows>
            <p className="mt-2 text-small text-ink-2">
              Reading a state record is a search and a detail, {money(STATE_RECORD_CENTS)}; just the detail, {money(PALM_PRICES.detail.cents)}, once the file number is on record. The daily check reads each
              record again once a week. Business records, the agent service, documents and filings aren't billed per call; a filing's state fee shows before it's submitted.
            </p>
          </CardSection>
        </div>
      </Sheet>
    </>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <span className="min-w-0 text-body text-ink-2">{label}</span>
      <span className="shrink-0 text-body text-ink tabular-nums">{value}</span>
    </div>
  );
}
