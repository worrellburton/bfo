/**
 * Mercury's own REST API (https://api.mercury.com/api/v1). One organization-
 * wide token (MERCURY_API_TOKEN) reads every account, and — unlike Plaid's
 * 90-day window — returns the account's full transaction history. Books uses
 * this as the source of truth for Mercury connections; Plaid still handles
 * balances for Treasury.
 *
 * Sign convention: Mercury signs money leaving the account NEGATIVE and money
 * arriving POSITIVE — the opposite of Plaid. Callers flip it to Plaid's
 * convention (outflow positive) so the two sources agree.
 */

const BASE = "https://api.mercury.com/api/v1";

export function mercuryConfigured(): boolean {
  return !!process.env.MERCURY_API_TOKEN;
}

export type MercuryAccount = {
  id: string;
  name: string | null;
  accountNumber: string | null;
  currentBalance: number | null;
  kind: string | null;
  status: string | null;
};

export type MercuryTxn = {
  id: string;
  amount: number;
  bankDescription: string | null;
  counterpartyName: string | null;
  note: string | null;
  externalMemo: string | null;
  kind: string | null;
  status: string | null;
  postedAt: string | null;
  createdAt: string | null;
};

async function mget(path: string): Promise<any> {
  const token = process.env.MERCURY_API_TOKEN;
  if (!token) throw new Error("MERCURY_API_TOKEN not set");
  const r = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (!r.ok) throw new Error(`Mercury ${path} → ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

export async function mercuryAccounts(): Promise<MercuryAccount[]> {
  const data = await mget("/accounts");
  return (data.accounts ?? []) as MercuryAccount[];
}

/** Full history for one Mercury account, from `sinceDay` (YYYY-MM-DD), paged. */
export async function mercuryTransactions(accountId: string, sinceDay: string): Promise<MercuryTxn[]> {
  const out: MercuryTxn[] = [];
  const limit = 500;
  for (let offset = 0; offset < 50000; offset += limit) {
    const data = await mget(
      `/account/${encodeURIComponent(accountId)}/transactions?limit=${limit}&offset=${offset}&start=${sinceDay}`
    );
    const txns = (data.transactions ?? []) as MercuryTxn[];
    out.push(...txns);
    const total = Number(data.total ?? out.length);
    if (txns.length < limit || out.length >= total) break;
  }
  return out;
}

/** Last four digits of a Mercury account number, to line up with a Plaid mask. */
export function mask4(accountNumber: string | null | undefined): string | null {
  const digits = (accountNumber ?? "").replace(/\D/g, "");
  return digits ? digits.slice(-4) : null;
}
