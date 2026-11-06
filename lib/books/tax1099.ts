import { fetchAll } from "../db-pages.js";
import { parseEntities, yearOf } from "./filters.js";
import { getPrefs, scopeFilter, withLiveEntity } from "./prefs.js";
import { cleanEntityName, label, placeTxn, scopeOf, unmatchedTransfers, type LedgerRow, type Scope } from "./statements.js";
import { ok, type BookTxn, type Query, type Reply } from "./types.js";

/**
 * The 1099 worksheet: who each entity paid enough, in a reportable way, to
 * need a 1099-NEC or 1099-MISC, and who was paid wages outside a payroll
 * service. Candidates only: the office's CPA decides what is filed.
 *
 * The rules:
 *  - The threshold is set by the year the payments were made: $600 through
 *    2025; $2,000 for payments made in 2026 (One Big Beautiful Bill Act,
 *    P.L. 119-21, amending IRC §6041(a) and §6041A); indexed for inflation
 *    after 2026, so a later year carries a note to confirm the figure.
 *  - NEC: contract services (6150) and professional fees (6100). MISC box 1:
 *    rent (6350). Salaries & Wages (6000) is never a 1099 account; people
 *    paid to 6000 directly, not through a payroll service, are listed apart
 *    for a worker-classification check.
 *  - Each payer entity files its own 1099s, so a payee is totalled per
 *    paying entity, across every payment to them that isn't intercompany or
 *    a matched transfer between the family's own accounts. Payments to the
 *    same payee filed as transfers are included and flagged.
 *  - Left out, with the reason shown: payments to governments (taxes are not
 *    1099 items), card payments and payment platforms (the processor reports
 *    them on a 1099-K), and marketplaces that pay the worker themselves.
 *  - Amounts to the cent (a working schedule).
 *
 * HTTP surface: none; api/books/data.ts serves it as GET ?report=tax1099.
 * Who may call it: staff with a login (the endpoint's role check).
 * Env: SUPABASE_URL and SUPABASE_SERVICE_KEY (through fetchAll).
 */

/** The reporting threshold for payments made in `year`. */
export function threshold1099(year: number): { amount: number; note: string | null } {
  if (year <= 2025) return { amount: 600, note: null };
  if (year === 2026) return { amount: 2000, note: null };
  return { amount: 2000, note: "The $2,000 threshold is indexed for inflation after 2026. Confirm this year's figure with your CPA." };
}

const GOVERNMENT =
  /internal revenue|\birs\b|irs treas|revenue agency|\brevenu|gcrevenu|gc<>revenu|franchise tax|dept\.? of revenue|department of revenue|tax collector|treasurer|comptroller|secretary of state|\bdmv\b|motor vehicle|\bcounty\b|\bcity of\b|\bstate of\b|us treasury|u\.s\. treasury|social security admin|\bssa\b|tax board|\bedd\b|employment development/i;
const PLATFORM = /\bpaypal\b|\bvenmo\b|\bsquare\b|\bstripe\b|\bshopify\b|\bamazon\b/i;
const MARKETPLACE = /\bupwork\b|\bfiverr\b|thumbtack|taskrabbit|\bangi\b|homeadvisor|\btoptal\b/i;
const PAYROLL = /\bgusto\b|\badp\b|paychex|rippling|justworks|trinet|paylocity|\bonpay\b|payroll/i;
const CORPORATION = /\b(inc|incorporated|corp|corporation)\b\.?/i;

const MERCURY_PAYEE = /via mercury\.com;\s*merchant name:\s*(.+)$/i;

/** Who was paid: for a Mercury row the payee named in its description, else the merchant, else the description. */
export function payeeOf(t: { name?: string | null; merchant_name?: string | null }): string {
  const m = (t.name ?? "").match(MERCURY_PAYEE);
  return (m ? m[1] : t.merchant_name || t.name || "Unknown").trim();
}

export type Form = "NEC" | "MISC";

/** The form an account's payments go on, or null when the account isn't a 1099 account. */
export function formFor(account: string): Form | null {
  const code = account.trim().slice(0, 4);
  if (code === "6100" || code === "6150") return "NEC";
  if (code === "6350") return "MISC";
  return null;
}

/** Why a payment is left out of the 1099 totals, or null when it counts. */
export function exclusionOf(t: { name?: string | null; merchant_name?: string | null; payment_channel?: string | null }, cardAccount: boolean): string | null {
  const who = `${payeeOf(t)} ${t.merchant_name ?? ""} ${t.name ?? ""}`;
  if (GOVERNMENT.test(who)) return "A government payee: tax payments aren't 1099 items.";
  if (cardAccount || t.payment_channel === "in store") return "Paid by card: the card processor reports it on a 1099-K.";
  if (MARKETPLACE.test(who)) return "A marketplace that pays the worker and reports it itself.";
  if (PLATFORM.test(who)) return "Paid through a payment platform, which reports it on a 1099-K.";
  return null;
}

type Payment = { cents: number; count: number; viaTransfers: number; transferCount: number; accounts: Set<string> };
export type Candidate = {
  payee: string;
  entity: string | null;
  form: Form;
  paid: number;
  count: number;
  accounts: string[];
  /** Included payments that were filed as transfers. */
  via_transfers: number;
  via_transfers_count: number;
  notes: string[];
};

/**
 * The 1099 worksheet over a year's posted rows for the selected entities.
 * `cardAccount` says whether a bank account is a card.
 */
export function worksheet1099(rows: Array<LedgerRow & { payment_channel?: string | null }>, scope: Scope, year: number, cardAccount: (accountId: string) => boolean) {
  const { amount: threshold, note } = threshold1099(year);
  const limitC = threshold * 100;
  const key = (t: LedgerRow) => `${t.entity_id ?? ""}\u0000${payeeOf(t).toLowerCase()}`;
  const byForm = new Map<string, Payment & { form: Form; payee: string; entity: string | null }>();
  const wages = new Map<string, { payee: string; entity: string | null; cents: number; count: number; viaTransfers: number; transferCount: number }>();
  const excluded = new Map<string, { payee: string; entity: string | null; cents: number; count: number; reason: string }>();

  // Transfers between the family's own accounts that found their other leg
  // are real moves; an unpaired "transfer" to a payee may be a payment.
  const transferish = rows.filter((t) => {
    const p = placeTxn(t, scope);
    return p.kind === "flow" && p.group === "own" && !p.eliminated;
  });
  const unpaired = new Set(unmatchedTransfers(transferish).map((t) => t.transaction_id));

  const outflows = rows.filter((t) => Number(t.amount) > 0);
  for (const t of outflows) {
    const p = placeTxn(t, scope);
    if (p.kind !== "line") continue;
    const acct = label(t);
    const cents = Math.round(Number(t.amount) * 100);
    const entity = cleanEntityName(t.entity_name) || null;
    if (acct.trim().startsWith("6000")) {
      if (PAYROLL.test(`${payeeOf(t)} ${t.name ?? ""}`)) continue;
      const k = key(t);
      const w = wages.get(k) ?? { payee: payeeOf(t), entity, cents: 0, count: 0, viaTransfers: 0, transferCount: 0 };
      w.cents += cents;
      w.count += 1;
      wages.set(k, w);
      continue;
    }
    const form = formFor(acct);
    if (!form) continue;
    const reason = exclusionOf(t, cardAccount(t.account_id));
    if (reason) {
      const k = `${key(t)}\u0000${reason}`;
      const e = excluded.get(k) ?? { payee: payeeOf(t), entity, cents: 0, count: 0, reason };
      e.cents += cents;
      e.count += 1;
      excluded.set(k, e);
      continue;
    }
    const k = `${key(t)}\u0000${form}`;
    const c = byForm.get(k) ?? { form, payee: payeeOf(t), entity, cents: 0, count: 0, viaTransfers: 0, transferCount: 0, accounts: new Set<string>() };
    c.cents += cents;
    c.count += 1;
    c.accounts.add(acct);
    byForm.set(k, c);
  }

  // Unpaired transfers out to someone already on the worksheet count toward them.
  for (const t of outflows) {
    if (!unpaired.has(t.transaction_id) || exclusionOf(t, cardAccount(t.account_id))) continue;
    const cents = Math.round(Number(t.amount) * 100);
    const w = wages.get(key(t));
    if (w) {
      w.cents += cents;
      w.count += 1;
      w.viaTransfers += cents;
      w.transferCount += 1;
      continue;
    }
    const c = byForm.get(`${key(t)}\u0000NEC`) ?? byForm.get(`${key(t)}\u0000MISC`);
    if (!c) continue;
    c.cents += cents;
    c.count += 1;
    c.viaTransfers += cents;
    c.transferCount += 1;
    c.accounts.add(label(t));
  }

  const all = [...byForm.values()];
  const candidates: Candidate[] = all
    .filter((c) => c.cents >= limitC)
    .map((c) => {
      const notes: string[] = [];
      if (c.viaTransfers) notes.push("Includes payments filed as transfers.");
      if (CORPORATION.test(c.payee))
        notes.push(
          c.accounts.has("6100 Professional Fees") || [...c.accounts].some((a) => a.startsWith("6100"))
            ? "A corporation: legal fees are reportable anyway."
            : "Looks like a corporation: usually exempt.",
        );
      return {
        payee: c.payee,
        entity: c.entity,
        form: c.form,
        paid: c.cents / 100,
        count: c.count,
        accounts: [...c.accounts].sort(),
        via_transfers: c.viaTransfers / 100,
        via_transfers_count: c.transferCount,
        notes,
      };
    })
    .sort((a, b) => b.paid - a.paid || a.payee.localeCompare(b.payee));

  return {
    year,
    threshold,
    threshold_note: note,
    candidates,
    below_threshold: all.filter((c) => c.cents < limitC).length,
    wages: [...wages.values()]
      .map((w) => ({ payee: w.payee, entity: w.entity, paid: w.cents / 100, count: w.count, via_transfers: w.viaTransfers / 100, via_transfers_count: w.transferCount }))
      .sort((a, b) => b.paid - a.paid),
    excluded: [...excluded.values()].map((e) => ({ payee: e.payee, entity: e.entity, paid: e.cents / 100, count: e.count, reason: e.reason })).sort((a, b) => b.paid - a.paid),
  };
}

const CARD = /credit|card|charge/i;

export async function tax1099Report(query: Query): Promise<Reply> {
  const year = yearOf(query.year);
  const selection = parseEntities(String(query.entity ?? "all"));
  const prefs = await getPrefs();
  const rows = withLiveEntity(
    await fetchAll<BookTxn>(`book_transactions?select=*&pending=eq.false&date=gte.${year}-01-01&date=lte.${year}-12-31${scopeFilter(prefs, selection)}&order=transaction_id.asc`),
    prefs,
  ) as LedgerRow[];
  const kinds = await fetchAll<{ account_id: string; subtype: string | null }>("plaid_account_prefs?select=account_id,subtype&order=account_id.asc").catch(() => []);
  const cards = new Set(kinds.filter((k) => CARD.test(k.subtype ?? "")).map((k) => k.account_id));
  return ok(worksheet1099(rows, scopeOf(prefs, selection), Number(year), (id) => cards.has(id)));
}
