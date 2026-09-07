/**
 * The Books chart of accounts, derived from the family's actual transaction
 * history rather than Plaid's generic labels. First matching rule wins; a
 * rule can also force the transaction's type:
 *
 *   'normal'       → counts in the P&L (income or expense by sign)
 *   'transfer'     → own-money movement, excluded from the P&L
 *   'intercompany' → entity-to-entity, eliminated in the all-entities rollup
 *
 * A rule with no type keeps whatever the sync's heuristics decided. A user's
 * type_override always beats both.
 */

import { sectionOf } from "./books-accounts.js";

export type RuleType = "normal" | "transfer" | "intercompany";

type Rule = {
  match: RegExp;
  category: string;
  type?: RuleType;
  /** Restrict the rule to these Plaid primary categories. */
  plaid?: RegExp;
  /**
   * Test the *counterparty* rather than the whole description. Mercury
   * descriptions lead with the family's own entity ("From Ledger Louise, LLC
   * via mercury.com; Merchant name: Griselda Ivonne") — that names the payer,
   * not who was paid — so an entity-name rule read against the full text
   * would call every payroll run an intercompany movement.
   */
  counterparty?: boolean;
};

const MERCURY_PAYEE = /via mercury\.com;\s*merchant name:\s*(.+)$/i;

/** The other party to the transaction — for Mercury rows, only the payee segment. */
export function counterpartyText(name: string | null, merchant: string | null): string {
  const m = (name ?? "").match(MERCURY_PAYEE);
  if (m) return m[1].trim();
  return `${merchant ?? ""} ${name ?? ""}`.trim();
}

// The family's entities, as they appear inside bank descriptions.
const ENTITY_NAMES =
  /sundown investments|fdj hesperia|ledger louise|breezewood|palomino|persons lodge|swisshelm|ledger burton|wadr law/i;

const MOVEMENT = /^(TRANSFER_IN|TRANSFER_OUT|INCOME|LOAN_DISBURSEMENTS|LOAN_PAYMENTS)$/;

const RULES: Rule[] = [
  // ── Taxes first — several arrive mislabelled as transfers ─────────────
  { match: /internal revenue|gcrevenu|gc<>revenu|cochise county treasurer/i, category: "6700 Taxes & Licenses", type: "normal" },

  // ── Real income and bills whose text often carries a family name — they
  //    must win before the broad internal-move rules below ───────────────
  { match: /social security|ssa treas/i, category: "4300 Social Security Income", type: "normal" },
  { match: /focus hospitalit/i, category: "4000 Rental Income", type: "normal" },
  { match: /interest payment|cashback|cash bonus for referring/i, category: "4100 Interest Income", type: "normal" },
  // Health-insurance claim payments — a real revenue stream, not "other income".
  { match: /hcclaimpmt|\baetna\b|\bkfhp\b|kaiser/i, category: "4400 Insurance & Claim Income", type: "normal" },
  { match: /tep corporate|tucson electric/i, category: "6250 Utilities", type: "normal" },
  { match: /payment escrow/i, category: "7000 Mortgage Interest", type: "normal" },
  { match: /io autopay|citi autopay|wf credit card|auto pay/i, category: "9150 Credit Card Payments", type: "transfer" },
  { match: /to visa signature card|citi card online payment|capital one mobile pmt/i, category: "9150 Credit Card Payments", type: "transfer" },

  // ── Loans the family expects back — reviewed in Transfers, not the P&L ─
  { match: /7a recovery|seven arrows/i, category: "9300 Loans", type: "transfer" },

  // ── Entity-to-entity movements ────────────────────────────────────────
  { match: ENTITY_NAMES, plaid: MOVEMENT, category: "9000 Intercompany", type: "intercompany", counterparty: true },

  // ── Family-internal movements (between the family's own accounts) ─────
  { match: /\bburton\b/i, plaid: MOVEMENT, category: "9100 Internal Transfers", type: "transfer", counterparty: true },
  { match: /transfer from mercury to another bank account|auto-routing transfer/i, category: "9100 Internal Transfers", type: "transfer" },
  { match: /mobile deposit/i, category: "9100 Internal Transfers", type: "transfer" },
  // Cash out of the family's own accounts — a draw, not an operating expense,
  // so it stays off the income statement.
  { match: /atm withdrawal|withdrawal authorized/i, category: "9200 Owner Draws", type: "transfer" },
  { match: /^check$/i, category: "6900 Other Operating Expenses", type: "normal" },

  { match: /catalog digital/i, category: "6150 Contract Services", type: "normal" },

  // ── Recurring operating expenses ──────────────────────────────────────
  { match: /liberty mutual|\bhartford\b|safeco|first insurance/i, category: "6200 Insurance" },
  { match: /nest payroll|gusto/i, category: "6000 Salaries & Wages" },
  { match: /legalzoom|ecm a legalzoom|\bafp\b|beachfleischman|beach fleischman|first gen law/i, category: "6100 Professional Fees" },
  { match: /mercury subscription|mercury technologies/i, category: "6400 Bank & Card Fees" },
  {
    match:
      /vercel|anthropic|claude|google cloud|openai|coefficient|resend|semrush|serpapi|surferseo|reddgrow|toggl|webshare|clerk|twilio|wispr|svg ai|plaid|intuit|wave\b|fal features|ayrshare|cmd-n|antinote|squarespace|webflow|crunchbase/i,
    category: "6450 Dues & Subscriptions",
  },
  { match: /d & m tire|\bbird\b/i, category: "6550 Automobile & Transport" },
  { match: /flora|amazon|barnes and noble/i, category: "6500 Supplies" },
];

// Plaid-category fallbacks, when no merchant rule matched.
const PLAID_FALLBACK: Array<[RegExp, string]> = [
  [/^TRANSPORTATION$/, "6550 Automobile & Transport"],
  [/^GENERAL_MERCHANDISE$/, "6500 Supplies"],
  [/^FOOD_AND_DRINK$/, "6600 Meals & Entertainment"],
  [/^ENTERTAINMENT$/, "6600 Meals & Entertainment"],
  [/^TRAVEL$/, "6650 Travel"],
  [/^RENT_AND_UTILITIES$/, "6250 Utilities"],
  [/^GOVERNMENT_AND_NON_PROFIT$/, "6700 Taxes & Licenses"],
  [/^GENERAL_SERVICES$/, "6900 Other Operating Expenses"],
  [/^MEDICAL$/, "6750 Medical"],
  [/^PERSONAL_CARE$/, "6900 Other Operating Expenses"],
  [/^INCOME$/, "4900 Other Income"],
  [/^TRANSFER_(IN|OUT)$/, "9100 Internal Transfers"],
  [/^LOAN_DISBURSEMENTS$/, "9300 Loans"],
  [/^LOAN_PAYMENTS$/, "9300 Loans"],
];

// The numbered chart of accounts lives in books-accounts; re-export it so the
// meta endpoint and the rule engine share one source of truth.
export { ACCOUNTS, sectionOf, CHART } from "./books-accounts.js";

type Db = (path: string, init?: RequestInit) => Promise<Response>;

/**
 * Apply `patch` to every transaction whose merchant/description literally
 * contains `needle` (case-insensitive) and satisfies `baseFilter`.
 *
 * Filtering happens in JS so it mirrors the nightly rule engine's
 * `text.includes()` exactly. A PostgREST `ilike` would instead treat `_` and
 * `%` — common in bank descriptors like ACH_PMT — as SQL wildcards, matching
 * unintended rows and disagreeing with the nightly pass. Returns the count
 * patched.
 */
export async function patchMatching(
  db: Db,
  needle: string,
  baseFilter: string,
  patch: Record<string, unknown>
): Promise<number> {
  const n = needle.trim().toLowerCase();
  if (n.length < 2) return 0;

  const ids: string[] = [];
  for (let from = 0; ; from += 1000) {
    const path =
      `book_transactions?select=transaction_id,name,merchant_name` +
      (baseFilter ? `&${baseFilter}` : "");
    const r = await db(path, { headers: { Range: `${from}-${from + 999}` } });
    if (!r.ok) break;
    const rows = (await r.json()) as Array<{
      transaction_id: string;
      name: string | null;
      merchant_name: string | null;
    }>;
    for (const t of rows) {
      if (`${t.merchant_name ?? ""} ${t.name ?? ""}`.toLowerCase().includes(n)) {
        ids.push(t.transaction_id);
      }
    }
    if (rows.length < 1000) break;
  }

  let done = 0;
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const list = chunk.map((id) => `"${id}"`).join(",");
    const r = await db(`book_transactions?transaction_id=in.(${list})`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
    if (r.ok) done += chunk.length;
  }
  return done;
}

export function categorize(
  name: string | null,
  merchant: string | null,
  plaidCategory: string | null
): { category: string | null; type: RuleType | null } {
  const text = `${merchant ?? ""} ${name ?? ""}`.trim();
  const counterparty = counterpartyText(name, merchant);
  const plaid = plaidCategory ?? "";

  for (const rule of RULES) {
    if (!rule.match.test(rule.counterparty ? counterparty : text)) continue;
    if (rule.plaid && !rule.plaid.test(plaid)) continue;
    return { category: rule.category, type: rule.type ?? null };
  }
  for (const [re, category] of PLAID_FALLBACK) {
    if (re.test(plaid)) return { category, type: null };
  }
  // Nothing matched — leave it genuinely uncategorized (null) so the
  // Uncategorized filter surfaces it, rather than a phantom "Uncategorized"
  // account that sits outside the chart.
  return { category: null, type: null };
}

/**
 * The type a chart account implies. Booking to a P&L account (4000s–7000s)
 * makes a row ordinary income/expense; 9000 Intercompany is a roll-up; the
 * other 9000s are the family's own money moving around.
 */
export function typeForCategory(category: string | null | undefined): RuleType | null {
  const section = sectionOf(category);
  if (!section) return null;
  if (section !== "flow") return "normal";
  return (category ?? "").trim().startsWith("9000") ? "intercompany" : "transfer";
}

/**
 * Final classification for a row. A user-taught account (a vendor's default
 * account, or "all of these, and from now on") beats the built-in chart —
 * and it decides the type too. Before this, the taught account won the
 * category column while the built-in rule still set the type, so a payroll
 * run booked to Salaries & Wages could arrive flagged as a roll-up.
 */
export function classify(
  name: string | null,
  merchant: string | null,
  plaidCategory: string | null,
  taughtCategory: string | null
): { category: string | null; type: RuleType | null } {
  const rule = categorize(name, merchant, plaidCategory);
  if (!taughtCategory) return rule;
  return { category: taughtCategory, type: typeForCategory(taughtCategory) ?? rule.type };
}
