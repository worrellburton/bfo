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

export type RuleType = "normal" | "transfer" | "intercompany";

type Rule = {
  match: RegExp;
  category: string;
  type?: RuleType;
  /** Restrict the rule to these Plaid primary categories. */
  plaid?: RegExp;
};

// The family's entities, as they appear inside bank descriptions.
const ENTITY_NAMES =
  /sundown investments|fdj hesperia|ledger louise|breezewood|palomino|persons lodge|swisshelm|ledger burton|wadr law/i;

const MOVEMENT = /^(TRANSFER_IN|TRANSFER_OUT|INCOME|LOAN_DISBURSEMENTS|LOAN_PAYMENTS)$/;

const RULES: Rule[] = [
  // ── Taxes first — several arrive mislabelled as transfers ─────────────
  { match: /internal revenue|gcrevenu|gc<>revenu|cochise county treasurer/i, category: "Taxes & government", type: "normal" },

  // ── Entity-to-entity movements ────────────────────────────────────────
  { match: ENTITY_NAMES, plaid: MOVEMENT, category: "Intercompany", type: "intercompany" },

  // ── Family-internal movements (between the family's own accounts) ─────
  { match: /^Burton$/i, plaid: MOVEMENT, category: "Internal moves", type: "transfer" },
  { match: /transfer from mercury to another bank account|auto-routing transfer/i, category: "Internal moves", type: "transfer" },
  { match: /io autopay|citi autopay|wf credit card|auto pay/i, category: "Credit card payments", type: "transfer" },
  { match: /mobile deposit/i, category: "Deposits", type: "transfer" },
  { match: /atm withdrawal|withdrawal authorized/i, category: "Cash withdrawals", type: "normal" },
  { match: /^check$/i, category: "Checks written", type: "normal" },

  // ── Income ────────────────────────────────────────────────────────────
  { match: /focus hospitalit/i, category: "Property income", type: "normal" },
  { match: /social security/i, category: "Social Security", type: "normal" },
  { match: /interest payment|cashback|cash bonus for referring/i, category: "Interest & rewards", type: "normal" },

  // ── Loans the family expects back — reviewed in Transfers, not the P&L ─
  { match: /7a recovery|seven arrows/i, category: "Seven Arrows Recovery (loan)", type: "transfer" },

  { match: /catalog digital/i, category: "Outside services", type: "normal" },

  // ── Recurring operating expenses ──────────────────────────────────────
  { match: /payment escrow/i, category: "Mortgage & escrow" },
  { match: /tep corporate|tucson electric/i, category: "Utilities" },
  { match: /liberty mutual/i, category: "Insurance" },
  { match: /nest payroll|gusto/i, category: "Payroll & HR" },
  { match: /legalzoom|ecm a legalzoom|\bafp\b/i, category: "Legal & professional" },
  { match: /mercury subscription|mercury technologies/i, category: "Bank & card fees" },
  {
    match:
      /vercel|anthropic|claude|google cloud|openai|coefficient|resend|semrush|serpapi|surferseo|reddgrow|toggl|webshare|clerk|twilio|wispr|svg ai|plaid|intuit|wave\b|fal features|ayrshare|cmd-n|antinote/i,
    category: "Software & technology",
  },
  { match: /d & m tire|\bbird\b/i, category: "Auto & transport" },
  { match: /flora|amazon|barnes and noble/i, category: "Merchandise & household" },
];

// Plaid-category fallbacks, when no merchant rule matched.
const PLAID_FALLBACK: Array<[RegExp, string]> = [
  [/^TRANSPORTATION$/, "Auto & transport"],
  [/^GENERAL_MERCHANDISE$/, "Merchandise & household"],
  [/^FOOD_AND_DRINK$/, "Food & dining"],
  [/^ENTERTAINMENT$/, "Entertainment"],
  [/^TRAVEL$/, "Travel"],
  [/^RENT_AND_UTILITIES$/, "Rent & utilities"],
  [/^GOVERNMENT_AND_NON_PROFIT$/, "Taxes & government"],
  [/^GENERAL_SERVICES$/, "Services (other)"],
  [/^MEDICAL$/, "Medical"],
  [/^PERSONAL_CARE$/, "Personal care"],
  [/^INCOME$/, "Other income"],
  [/^LOAN_DISBURSEMENTS$/, "Loan proceeds"],
  [/^LOAN_PAYMENTS$/, "Loan payments"],
];

export function categorize(
  name: string | null,
  merchant: string | null,
  plaidCategory: string | null
): { category: string; type: RuleType | null } {
  const text = `${merchant ?? ""} ${name ?? ""}`.trim();
  const plaid = plaidCategory ?? "";

  for (const rule of RULES) {
    if (!rule.match.test(text)) continue;
    if (rule.plaid && !rule.plaid.test(plaid)) continue;
    return { category: rule.category, type: rule.type ?? null };
  }
  for (const [re, category] of PLAID_FALLBACK) {
    if (re.test(plaid)) return { category, type: null };
  }
  return { category: "Uncategorized", type: null };
}
