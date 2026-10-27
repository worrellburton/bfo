import type { VercelRequest } from "@vercel/node";
import type { AppUser } from "../auth.js";

/**
 * Shared shapes for the Books endpoint (api/books/data.ts) and the modules
 * it dispatches to. Each report and action is a plain function that returns
 * a Reply; the router turns that into the HTTP response, so the modules
 * never touch res and tests can call them with a fake db alone.
 */

export type Reply = { status: number; body: unknown };

export const ok = (body: unknown): Reply => ({ status: 200, body });
export const fail = (status: number, body: unknown): Reply => ({ status, body });

/** A GET report sees the parsed query string. */
export type Query = VercelRequest["query"];

/** A POST action sees the JSON body and who is editing. */
export type WriteCtx = { body: any; user: AppUser };

export type BookTxn = {
  transaction_id: string;
  account_id: string;
  item_id: string;
  date: string;
  name: string | null;
  merchant_name: string | null;
  amount: number;
  pending: boolean;
  currency: string | null;
  plaid_category: string | null;
  plaid_category_detailed: string | null;
  payment_channel: string | null;
  txn_type: string;
  intercompany: boolean;
  intercompany_class: string | null;
  counterparty_account_id: string | null;
  type_override: string | null;
  book_category: string | null;
  loan_id: string | null;
  entity_id: string | null;
  entity_name: string | null;
  updated_at?: string;
};

export type Pref = {
  account_id: string;
  entity_id: string | null;
  entity_name: string | null;
  hidden: boolean;
  nickname?: string | null;
  account_name?: string | null;
  mask?: string | null;
  institution_name?: string | null;
};
