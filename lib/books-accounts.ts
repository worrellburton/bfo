/**
 * The Books chart of accounts — a numbered, GAAP-style structure used by the
 * income statement and the account pickers.
 *
 *   4000s  Revenue
 *   6000s  Operating expenses
 *   7000s  Other income / (expense)   (below-the-line: interest, depreciation)
 *   9000s  Flow accounts              (transfers, intercompany, loans — never
 *                                       on the income statement; shown in their
 *                                       own sections instead)
 *
 * Accounts are stored on each transaction as "<code> <name>" (e.g.
 * "4000 Rental Income"), so the code both labels the row and sorts it into the
 * right statement group. The P&L groups by the leading digit; the balance
 * sheet is unaffected (it keys on the bank account's subtype, not this chart).
 */

export type Section = "revenue" | "operating" | "other" | "flow";

export type Account = { code: string; name: string; section: Section };

export const CHART: Account[] = [
  // ── 4000 · Revenue ────────────────────────────────────────────────────
  { code: "4000", name: "Rental Income", section: "revenue" },
  { code: "4100", name: "Interest Income", section: "revenue" },
  { code: "4200", name: "Dividend & Investment Income", section: "revenue" },
  { code: "4300", name: "Social Security Income", section: "revenue" },
  { code: "4400", name: "Insurance & Claim Income", section: "revenue" },
  { code: "4900", name: "Other Income", section: "revenue" },

  // ── 6000 · Operating expenses ─────────────────────────────────────────
  { code: "6000", name: "Salaries & Wages", section: "operating" },
  { code: "6100", name: "Professional Fees", section: "operating" },
  { code: "6150", name: "Contract Services", section: "operating" },
  { code: "6200", name: "Insurance", section: "operating" },
  { code: "6250", name: "Utilities", section: "operating" },
  { code: "6300", name: "Repairs & Maintenance", section: "operating" },
  { code: "6350", name: "Rent Expense", section: "operating" },
  { code: "6400", name: "Bank & Card Fees", section: "operating" },
  { code: "6450", name: "Dues & Subscriptions", section: "operating" },
  { code: "6500", name: "Supplies", section: "operating" },
  { code: "6550", name: "Automobile & Transport", section: "operating" },
  { code: "6600", name: "Meals & Entertainment", section: "operating" },
  { code: "6650", name: "Travel", section: "operating" },
  { code: "6700", name: "Taxes & Licenses", section: "operating" },
  { code: "6750", name: "Medical", section: "operating" },
  { code: "6900", name: "Other Operating Expenses", section: "operating" },

  // ── 7000 · Other income / (expense) ───────────────────────────────────
  { code: "7000", name: "Mortgage Interest", section: "other" },
  { code: "7100", name: "Depreciation & Amortization", section: "other" },

  // ── 9000 · Flow (off the income statement) ────────────────────────────
  { code: "9000", name: "Intercompany", section: "flow" },
  { code: "9100", name: "Internal Transfers", section: "flow" },
  { code: "9150", name: "Credit Card Payments", section: "flow" },
  { code: "9200", name: "Owner Draws", section: "flow" },
  { code: "9210", name: "Trustee Draws — Amanda", section: "flow" },
  { code: "9220", name: "Trustee Draws — Bobby", section: "flow" },
  { code: "9300", name: "Loans", section: "flow" },
];

export const acctLabel = (a: Account) => `${a.code} ${a.name}`;

/** The chart as picker-ready labels, e.g. "4000 Rental Income". */
export const ACCOUNTS: string[] = CHART.map(acctLabel);

/** By code, e.g. "4000 Rental Income" → "4000". */
const byCode = new Map(CHART.map((a) => [a.code, a] as const));

/** Which statement group a stored account label belongs to (null if it isn't
 *  a chart account — an uncategorized Plaid label). */
export function sectionOf(label: string | null | undefined): Section | null {
  if (!label) return null;
  const code = label.trim().slice(0, 4);
  return byCode.get(code)?.section ?? null;
}

/**
 * Old informal category → new GAAP account label. Used both to migrate the
 * existing data and to keep the rule engine emitting the numbered labels.
 */
export const MIGRATE: Record<string, string> = {
  "Property income": "4000 Rental Income",
  "Interest & rewards": "4100 Interest Income",
  "Social Security": "4300 Social Security Income",
  "Other income": "4900 Other Income",
  "Payroll & HR": "6000 Salaries & Wages",
  "Legal & professional": "6100 Professional Fees",
  "Outside services": "6150 Contract Services",
  "Insurance": "6200 Insurance",
  "Utilities": "6250 Utilities",
  "Rent & utilities": "6250 Utilities",
  "Bank & card fees": "6400 Bank & Card Fees",
  "Software & technology": "6450 Dues & Subscriptions",
  "Merchandise & household": "6500 Supplies",
  "Auto & transport": "6550 Automobile & Transport",
  "Food & dining": "6600 Meals & Entertainment",
  "Entertainment": "6600 Meals & Entertainment",
  "Travel": "6650 Travel",
  "Taxes & government": "6700 Taxes & Licenses",
  "Medical": "6750 Medical",
  "Personal care": "6900 Other Operating Expenses",
  "Contracts": "6150 Contract Services",
  "Services (other)": "6900 Other Operating Expenses",
  "Checks written": "6900 Other Operating Expenses",
  "Cash withdrawals": "9200 Owner Draws",
  "Mortgage & escrow": "7000 Mortgage Interest",
  "Intercompany": "9000 Intercompany",
  "Internal moves": "9100 Internal Transfers",
  "Deposits": "9100 Internal Transfers",
  "Other transfers": "9100 Internal Transfers",
  "Credit card payments": "9150 Credit Card Payments",
  "Seven Arrows Recovery (loan)": "9300 Loans",
  "Loan proceeds": "9300 Loans",
  "Loan payments": "9300 Loans",
};
