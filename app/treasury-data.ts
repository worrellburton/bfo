/**
 * Treasury's data on the client: the account shapes the API sends, the reads,
 * the entities and people from the records (live names), one way to name an
 * account, and the confirm and save for an owner change. Shared by the
 * Treasury pages and Investments; components are in app/treasury-ui.tsx.
 */
import { useEffect, useMemo, useState } from "react";
import { authFetch } from "./auth";
import { confirm, format } from "./ui";
import { ownerConflict, registration, stripBankMask, type OwnerKind, type TaxStatus, type Tenancy } from "./treasury-model";

export type Account = {
  item_id: string;
  institution_name: string;
  institution_color?: string | null;
  institution_logo: string | null;
  account_id: string;
  name: string;
  official_name: string | null;
  mask: string | null;
  type: string;
  subtype: string | null;
  balance_current: number | null;
  balance_available: number | null;
  balance_limit?: number | null;
  balance_updated_at?: string | null;
  currency: string | null;
  change: number | null;
  change_since: string | null;
  /** "prior_close" once the server measures change against the prior day's close. */
  change_basis?: string | null;
  nickname: string | null;
  hidden: boolean;
  entity_id: string | null;
  entity_name: string | null;
  owner_kind?: OwnerKind | null;
  owner_names?: string[] | null;
  tenancy?: Tenancy | null;
  tax_status?: TaxStatus | null;
  beneficiary_entity_id?: string | null;
  beneficiary_name?: string | null;
  last_activity?: string | null;
};

export type Connection = {
  item_id: string;
  institution_name: string;
  institution_logo: string | null;
  status: "online" | "reconnect" | "offline";
  created_at?: string | null;
  balances_at?: string | null;
  bank_updated_at?: string | null;
  message?: string | null;
};

/** An account that stopped syncing, whose Books history is kept. */
export type StoppedAccount = {
  account_id: string;
  institution_name: string | null;
  name: string | null;
  nickname: string | null;
  mask: string | null;
  subtype: string | null;
  type: string | null;
  last_balance: number | null;
  last_balance_at: string | null;
  disconnected_at: string;
  reason: "disconnected" | "not_shared" | null;
  books_through: string | null;
  hidden: boolean;
  entity_id: string | null;
  entity_name: string | null;
  owner_kind?: OwnerKind | null;
  owner_names?: string[] | null;
};

export type TreasuryData = { asOf: string; complete?: boolean; connections: Connection[]; accounts: Account[]; disconnected: StoppedAccount[] };

export type Entity = { id: string; name: string; type: string | null };

/** GET a JSON endpoint; a failed answer throws its plain message. */
export async function getJson<T = any>(path: string, init?: RequestInit): Promise<T> {
  const res = await authFetch(path, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data?.message || "Something went wrong. Try again."), { status: res.status, code: data?.error });
  return data as T;
}

export async function loadTreasury(): Promise<TreasuryData> {
  const started = new Date().toISOString();
  const data = await getJson<Partial<TreasuryData>>("/api/plaid/data?report=treasury");
  return { asOf: data.asOf ?? started, complete: data.complete, connections: data.connections ?? [], accounts: data.accounts ?? [], disconnected: data.disconnected ?? [] };
}

/**
 * The entities (live names, from the records) and the people named on them,
 * for owner pickers and headings. Names are read at render, never trusted
 * from the copy stored when an account was mapped.
 */
export function useRecords(): { entities: Entity[]; people: string[]; loaded: boolean; nameOf: (id: string) => string | null; isTrust: (id: string | null | undefined) => boolean } {
  const [state, setState] = useState<{ entities: Entity[]; people: string[]; loaded: boolean }>({ entities: [], people: [], loaded: false });
  useEffect(() => {
    let unsub: (() => void) | undefined;
    let cancelled = false;
    void (async () => {
      const { db, authReady, ref, onValue } = await import("./store");
      await authReady;
      if (cancelled) return;
      unsub = onValue(ref(db, "assets"), (snap) => {
        const data = (snap.val() || {}) as Record<string, any>;
        const entities = Object.entries(data)
          .map(([id, a]) => ({ id, name: String(a?.name || "Unnamed entity"), type: a?.type ? String(a.type) : null }))
          .sort((a, b) => a.name.localeCompare(b.name));
        const orgs = new Set(entities.map((e) => e.name.toLowerCase()));
        const people = new Set<string>();
        for (const a of Object.values(data)) {
          for (const m of (a?.members ?? []) as Array<{ name?: string }>) {
            const n = (m?.name ?? "").trim();
            if (n && !orgs.has(n.toLowerCase()) && !/\b(llc|inc|corp|trust|lp|ltd|company|partners)\b/i.test(n)) people.add(n);
          }
        }
        setState({ entities, people: [...people].sort((x, y) => x.localeCompare(y)), loaded: true });
      });
    })().catch(() => setState((s) => ({ ...s, loaded: true })));
    return () => {
      cancelled = true;
      unsub?.();
    };
  }, []);
  return useMemo(() => {
    const byId = new Map(state.entities.map((e) => [e.id, e]));
    return {
      ...state,
      nameOf: (id: string) => byId.get(id)?.name ?? null,
      isTrust: (id: string | null | undefined) => !!id && (byId.get(id)?.type === "Trust" || /\btrust\b/i.test(byId.get(id)?.name ?? "")),
    };
  }, [state]);
}

/** "Operating checking •• 4821": the nickname, else the bank's name tidied and without its own mask, then the last four (§10.8). */
export function accountName(a: { nickname?: string | null; official_name?: string | null; name?: string | null; mask?: string | null }): string {
  return format.accountLabel({ nickname: a.nickname, name: stripBankMask(a.official_name || a.name, a.mask), mask: a.mask }).replace(/\bWros\b/, "WROS");
}

/** The bank's own name for it, when a nickname replaced it on screen. */
export function officialName(a: { nickname?: string | null; official_name?: string | null; name?: string | null; mask?: string | null }): string | null {
  if (!a.nickname) return null;
  return format.accountLabel({ name: stripBankMask(a.official_name || a.name, a.mask), mask: a.mask });
}

/** "Traditional IRA", "Checking", "Credit card": from the registration when it says more, else the type map. */
export function typeLabel(a: { subtype?: string | null; type?: string | null; name?: string | null; official_name?: string | null }): string {
  const reg = registration(a.official_name || a.name, a.subtype);
  if (reg && reg.kind === "retirement") return reg.label;
  return format.accountType(a.subtype || a.type || "") || "Account";
}

/** How an account's owner reads in a meta line or a picker trigger. */
export function ownerText(
  a: { owner_kind?: OwnerKind | null; owner_names?: string[] | null; entity_id?: string | null; entity_name?: string | null },
  nameOf: (id: string) => string | null,
): string | null {
  if (a.owner_kind === "person" && a.owner_names?.length) return a.owner_names[0];
  if (a.owner_kind === "joint" && a.owner_names?.length) return `${a.owner_names.join(" & ")}, jointly`;
  if (a.entity_id) return nameOf(a.entity_id) ?? a.entity_name ?? null;
  return null;
}

export type OwnerChoice = {
  owner_kind: OwnerKind | null;
  owner_names?: string[];
  tenancy?: Tenancy | null;
  entity_id?: string;
  entity_name?: string;
  tax_status?: TaxStatus | null;
  beneficiary_entity_id?: string;
  beneficiary_name?: string;
};

/**
 * Ask before an owner change, stating what moves: Books resolves every past
 * transaction's entity from the current mapping, so a move takes the whole
 * history with it (§11.1 "Never silently").
 */
export async function confirmOwnerChange(a: Account | (Partial<Account> & { account_id: string }), fromText: string | null, toText: string | null, toPerson: boolean): Promise<boolean> {
  let books: { count: number; from: string | null; to: string | null } | null = null;
  try {
    books = (await getJson<{ books: { count: number; from: string | null; to: string | null } }>(`/api/plaid/account-prefs?account_id=${encodeURIComponent(a.account_id)}`)).books;
  } catch {
    books = null;
  }
  const span = books && books.count > 0 && books.from && books.to ? `${format.count(books.count, "Books transaction")}, ${format.dateRange(books.from, books.to)}` : null;
  const history = span ? `Its ${span}, move with it, closed periods included.` : "Its Books history, if any, moves with it.";
  const r = await confirm({
    title: fromText ? "Change this account's owner?" : "Set this account's owner?",
    object: { name: accountName(a), detail: [fromText ? `From ${fromText}` : "No owner yet", `to ${toText ?? "no owner"}`].join(" ") },
    message: toPerson
      ? `${toText} becomes the owner, and the account leaves every entity's Books. ${span ? `Its ${span}, stop counting toward ${fromText ?? "an entity"}.` : ""}`.trim()
      : `Books and each entity's statements use this. ${history}`,
    details: ["Recorded with your name and the time, on both entities' activity."],
    confirmLabel: fromText ? "Change owner" : "Set owner",
    tone: "commit",
  });
  return r !== false;
}

/** Save an owner choice through the API; null when saved, else the plain reason. */
export async function saveOwner(accountId: string, choice: OwnerChoice): Promise<string | null> {
  try {
    await getJson("/api/plaid/account-prefs", { method: "POST", body: JSON.stringify({ account_id: accountId, ...choice }) });
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : "Couldn't save the owner.";
  }
}

/** The one-line note on a row whose owner contradicts its registration, or null. */
export function conflictOf(a: Account, isTrust: (id: string | null | undefined) => boolean): string | null {
  return ownerConflict({ name: a.name, official_name: a.official_name, subtype: a.subtype, entity_id: a.entity_id, owner_kind: a.owner_kind ?? null }, isTrust(a.entity_id));
}

/** An account that stopped syncing, in the shape the pages draw, from its kept row. */
export function stoppedAsAccount(s: StoppedAccount): Account {
  return {
    item_id: "",
    institution_name: s.institution_name ?? "",
    institution_logo: null,
    account_id: s.account_id,
    name: s.name ?? "",
    official_name: null,
    mask: s.mask,
    type: s.type ?? "",
    subtype: s.subtype,
    balance_current: s.last_balance,
    balance_available: null,
    currency: "USD",
    change: null,
    change_since: null,
    nickname: s.nickname,
    hidden: s.hidden,
    entity_id: s.entity_id,
    entity_name: s.entity_name,
    owner_kind: s.owner_kind ?? null,
    owner_names: s.owner_names ?? null,
  };
}
