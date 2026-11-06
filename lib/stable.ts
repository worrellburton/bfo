import { logActivity } from "./activity.js";
import { sb } from "./auth.js";
import { notifyNewPaperMail } from "./push.js";
import { storageUpload } from "./storage.js";
import { readCollection } from "./tree.js";

/**
 * Stable (usestable.com): the family office's mailbox in Phoenix. Each piece
 * of paper mail is copied into public.stable_mail, with its envelope photo
 * and, once scanned, its contents kept in the private "mail" bucket (Stable's
 * links expire), and tied to the BFO entity it's addressed to. A webhook says
 * something changed; the API is what's believed.
 *
 * Filing is cautious: a piece is filed by itself ("auto") only when a line on
 * the envelope names one entity exactly, entity type included, and no other
 * entity shares that entity's name. Anything else waits in "Needs an entity"
 * for staff, and partners see an auto-filed piece only once staff confirm it
 * (api/stable.ts).
 *
 * HTTP surface: none; used by api/stable.ts and api/stable-webhook.ts.
 * Env: STABLE_API_KEY (Stable → Settings → API keys).
 */

const BASE = "https://api.usestable.com";

export class StableNotConfigured extends Error {}

async function stable<T>(path: string): Promise<T> {
  const key = process.env.STABLE_API_KEY;
  if (!key) throw new StableNotConfigured("Add STABLE_API_KEY in Vercel.");
  const r = await fetch(`${BASE}${path}`, { headers: { "x-api-key": key, Accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error(`stable ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return (await r.json()) as T;
}

export type StableMailItem = {
  id: string;
  from?: string | null;
  createdAt?: string | null;
  archivedAt?: string | null;
  readAt?: string | null;
  imageUrl?: string | null;
  recipients?: {
    line1?: { text?: string | null } | null;
    line2?: { text?: string | null } | null;
    business?: { id: string; name: string } | null;
    individual?: { id: string; firstName: string; lastName: string } | null;
  } | null;
  businessRecipient?: string | null;
  individualRecipient?: string | null;
  scanDetails?: { imageUrl?: string | null; status?: string | null; summary?: string | null } | null;
  forwardDetails?: { status?: string | null; trackingNumber?: string | null } | null;
  shredDetails?: { status?: string | null } | null;
  checks?: unknown[] | null;
  isReturnedToSender?: boolean | null;
  /** Stable's own label for the piece, as on the envelope's sticker ("STABLE-1B1034888"). */
  barcodeId?: string | null;
  /** When Stable clears the piece from the dashboard. */
  clearAt?: string | null;
  location?: { address?: { line1?: string | null; line2?: string | null; city?: string | null; state?: string | null; postalCode?: string | null } | null } | null;
  tags?: unknown[] | null;
  depositDetails?: { status?: string | null } | null;
};

type Page = { edges?: { node: StableMailItem; cursor?: string }[]; pageInfo?: { hasNextPage?: boolean; endCursor?: string | null } };

/** Mail items received since `since` (ISO), newest pages followed to the end. */
async function listMailSince(since: string, max = 500): Promise<StableMailItem[]> {
  const out: StableMailItem[] = [];
  let after: string | null = null;
  for (let page = 0; page < 10 && out.length < max; page++) {
    const q = new URLSearchParams({ createdAt_gte: since, first: "100" });
    if (after) q.set("after", after);
    const r = await stable<Page>(`/v1/mail-items?${q}`);
    out.push(...(r.edges ?? []).map((e) => e.node));
    if (!r.pageInfo?.hasNextPage || !r.pageInfo.endCursor) break;
    after = r.pageInfo.endCursor;
  }
  return out;
}

export const getMailItem = (id: string) => stable<StableMailItem>(`/v1/mail-items/${encodeURIComponent(id)}`);

// ── Which entity a piece is for ─────────────────────────────────────────

const DESIGNATORS = /\b(l ?l ?c|inc|incorporated|corp|corporation|co|company|ltd|limited|lp|l ?p|llp|l ?l ?l ?p|pllc|p ?l ?l ?c|trust|the)\b/g;

/** "Northwind Holdings, L.L.C." → "northwind holdings": the base name, without punctuation or the entity type. */
export function normName(s: string | null | undefined): string {
  return (s ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(DESIGNATORS, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The entity-type words, each written one way, so "L.L.C." and "LLC" or "Incorporated" and "Inc" compare equal. */
const TYPE_WORD: [RegExp, string][] = [
  [/\bl l l p\b/g, "llp"],
  [/\bl l c\b/g, "llc"],
  [/\bl l p\b/g, "llp"],
  [/\bp l l c\b/g, "pllc"],
  [/\bl p\b/g, "lp"],
  [/\bincorporated\b/g, "inc"],
  [/\bcorporation\b/g, "corp"],
  [/\bcompany\b/g, "co"],
  [/\blimited\b/g, "ltd"],
];
const TYPE_END = /\b(llc|inc|corp|co|ltd|lp|llp|pllc|trust)$/;

/** "Northwind Holdings, L.L.C." → "northwind holdings llc": the full name, entity type included, compared without punctuation. */
export function entityKey(s: string | null | undefined): string {
  let k = (s ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^the /, "");
  for (const [re, to] of TYPE_WORD) k = k.replace(re, to);
  return k;
}

/**
 * The entity whose exact name the envelope carries, or null. A line must
 * name the entity in full with its type ("NORTHWIND HOLDINGS LLC"), on its own
 * or inside a longer line ("NORTHWIND HOLDINGS LLC C/O A RIVERA"). Never filed:
 * a name two entities share once the type is set aside ("Northwind Trust" and
 * "Northwind LLC"), since an envelope often drops or splits the type; and a
 * piece whose lines name two different entities. Better unfiled than in front
 * of the wrong entity's partner.
 */
export function matchEntity(item: StableMailItem, entities: { id: string; name: string }[]): string | null {
  const baseCount = new Map<string, number>();
  for (const e of entities) {
    const b = normName(e.name);
    if (b) baseCount.set(b, (baseCount.get(b) ?? 0) + 1);
  }
  const keyed = new Map<string, string[]>();
  for (const e of entities) {
    const k = entityKey(e.name);
    if (k) keyed.set(k, [...(keyed.get(k) ?? []), e.id]);
  }
  // Unambiguous names only: one entity with this full name, and no other with the same base name.
  const usable = [...keyed.entries()].filter(([k, ids]) => ids.length === 1 && (baseCount.get(normName(k)) ?? 0) <= 1).map(([k, ids]) => [k, ids[0]] as const);
  const lines = [item.recipients?.business?.name, item.recipients?.line1?.text, item.recipients?.line2?.text, item.businessRecipient].map(entityKey).filter(Boolean);
  const hits = new Set<string>();
  for (const line of lines) {
    for (const [key, id] of usable) {
      if (line === key) hits.add(id);
      // Inside a longer line: only a full name that ends in its entity type, long enough not to be a common word.
      else if (key.length >= 8 && TYPE_END.test(key) && ` ${line} `.includes(` ${key} `)) hits.add(id);
    }
  }
  return hits.size === 1 ? [...hits][0] : null;
}

// ── Checks inside a piece ───────────────────────────────────────────────

/** One check Stable found in a piece, as far as Stable's record says. Amounts in cents; null when not given or unclear. */
export type PaperCheck = {
  amountCents: number | null;
  payer: string | null;
  payee: string | null;
  number: string | null;
  date: string | null;
  /** Stable's deposit status (pending, processing, completed…). */
  status: string | null;
  depositedAt: string | null;
  /** Where it went, as Stable names the account ("Operating •• 4821"). */
  account: string | null;
};

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, 200) : typeof v === "number" && Number.isFinite(v) ? String(v) : null);
const pick = (o: Record<string, unknown>, ...keys: string[]) => {
  for (const k of keys) {
    const v = o[k];
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const inner = v as Record<string, unknown>;
      const n = text(inner.name) ?? text(inner.displayName) ?? text(inner.label);
      if (n) return n;
    }
    const t = text(v);
    if (t) return t;
  }
  return null;
};

/**
 * An amount in cents, only when its unit is plain: a field named in cents, or
 * dollars written with a decimal point ("1240.00", "$1,240.00", 1240.5). A
 * bare whole number could be either, so it isn't guessed. Pure.
 */
export function centsOf(o: Record<string, unknown>): number | null {
  for (const k of ["amountCents", "amount_cents", "amountInCents", "amount_in_cents"]) {
    const v = o[k];
    if (typeof v === "number" && Number.isInteger(v) && v >= 0) return v;
  }
  const raw = o.amount && typeof o.amount === "object" ? ((o.amount as Record<string, unknown>).value ?? (o.amount as Record<string, unknown>).amount) : o.amount;
  if (typeof raw === "string") {
    const m = /^\s*\$?\s*([\d,]+\.\d{1,2})\s*$/.exec(raw);
    if (m) return Math.round(Number(m[1].replace(/,/g, "")) * 100);
  }
  if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0 && !Number.isInteger(raw)) return Math.round(raw * 100);
  return null;
}

/** Each check in Stable's record of a piece, read field by field; unknown shapes give empty fields, never a guess. Pure. */
export function checksOf(item: Pick<StableMailItem, "checks" | "depositDetails"> | null | undefined): PaperCheck[] {
  const list = Array.isArray(item?.checks) ? item.checks : [];
  return list.slice(0, 20).map((c) => {
    const o = (c && typeof c === "object" ? c : {}) as Record<string, unknown>;
    const dep = (o.depositDetails && typeof o.depositDetails === "object" ? o.depositDetails : o.deposit && typeof o.deposit === "object" ? o.deposit : {}) as Record<string, unknown>;
    return {
      amountCents: centsOf(o),
      payer: pick(o, "payer", "payerName", "from", "drawer", "issuer"),
      payee: pick(o, "payee", "payeeName", "payTo", "to"),
      number: pick(o, "checkNumber", "number", "check_number"),
      date: pick(o, "checkDate", "date", "issuedAt", "dated"),
      status: pick(dep, "status") ?? pick(o, "depositStatus", "status") ?? text(item?.depositDetails?.status),
      depositedAt: pick(dep, "depositedAt", "completedAt", "date") ?? pick(o, "depositedAt"),
      account: pick(dep, "account", "accountName", "destination", "bankAccount") ?? pick(o, "account", "depositAccount"),
    };
  });
}

// ── Keeping a piece ─────────────────────────────────────────────────────

export type MailRow = {
  id: string;
  asset_id: string | null;
  assigned: "auto" | "hand";
  from_name: string | null;
  recipient: string | null;
  recipient2: string | null;
  received_at: string | null;
  envelope_path: string | null;
  scan_path: string | null;
  scan_status: string | null;
  summary: string | null;
  checks: number;
  forward_status: string | null;
  shred_status: string | null;
  returned_to_sender: boolean;
  archived_at: string | null;
  read_at: string | null;
  updated_at: string;
  /** Stable's item as last fetched. */
  data?: StableMailItem | null;
  /** What BFO read off the envelope and scan (lib/paper-read.ts), and from which copies. */
  reading?: unknown;
  reading_from?: string | null;
  reading_at?: string | null;
};

const EXT: Record<string, string> = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };

/** A copy of a file behind one of Stable's expiring links, in the mail bucket. */
async function keep(url: string, name: string): Promise<string | null> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!r.ok) return null;
    const type = (r.headers.get("content-type") || "application/octet-stream").split(";")[0].trim().toLowerCase();
    const bytes = new Uint8Array(await r.arrayBuffer());
    if (!bytes.length || bytes.length > 40 * 1024 * 1024) return null;
    return await storageUpload(`stable/${name}.${EXT[type] ?? "bin"}`, bytes, type, "mail");
  } catch (err) {
    console.error("stable: couldn't keep", name, err);
    return null;
  }
}

const STABLE = { id: null, name: "Stable", source: "stable" } as const;

/** Store (or refresh) pieces of mail. `entities` decides which entity each is for, unless someone chose by hand. */
export async function saveMail(items: StableMailItem[], entities?: { id: string; name: string }[]): Promise<number> {
  if (!items.length) return 0;
  const list = entities ?? (await readCollection("assets")).map((r) => ({ id: r.id, name: String((r.data as { name?: string } | null)?.name ?? "") }));
  const ids = items.map((i) => `"${i.id.replace(/"/g, "")}"`).join(",");
  const existing = new Map((await sb<MailRow[]>(`stable_mail?id=in.(${encodeURIComponent(ids)})&select=*`)).map((r) => [r.id, r]));
  const rows = [];
  for (const item of items) {
    const prev = existing.get(item.id);
    const envelope = prev?.envelope_path ?? (item.imageUrl ? await keep(item.imageUrl, `${item.id}/envelope`) : null);
    const scanned = item.scanDetails?.status === "completed" && item.scanDetails.imageUrl;
    const scan = prev?.scan_path ?? (scanned ? await keep(item.scanDetails!.imageUrl!, `${item.id}/scan`) : null);
    rows.push({
      id: item.id,
      // Staff's choice stands. Otherwise the envelope decides, under today's rules; with no entity list to compare
      // against (it couldn't be read), the earlier answer stays rather than unfiling everything.
      asset_id: prev?.assigned === "hand" ? prev.asset_id : list.length ? matchEntity(item, list) : (prev?.asset_id ?? null),
      assigned: prev?.assigned ?? "auto",
      from_name: item.from ?? null,
      recipient: item.recipients?.line1?.text ?? item.businessRecipient ?? null,
      recipient2: item.recipients?.line2?.text ?? item.individualRecipient ?? null,
      received_at: item.createdAt ?? prev?.received_at ?? null,
      envelope_path: envelope,
      scan_path: scan,
      scan_status: item.scanDetails?.status ?? null,
      summary: item.scanDetails?.summary ?? null,
      checks: item.checks?.length ?? 0,
      forward_status: item.forwardDetails?.status ?? null,
      shred_status: item.shredDetails?.status ?? null,
      returned_to_sender: !!item.isReturnedToSender,
      archived_at: item.archivedAt ?? null,
      // Read in BFO stays read; read in Stable counts too.
      read_at: prev?.read_at ?? item.readAt ?? null,
      data: item,
      updated_at: new Date().toISOString(),
    });
  }
  await sb("stable_mail?on_conflict=id", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: rows });
  // A piece seen for the first time rings the phones of those who want to know.
  await notifyNewPaperMail(rows.filter((r) => !existing.has(r.id)));
  // A piece that's new here, or newly matched, shows in its entity's activity.
  for (const r of rows) {
    if (!r.asset_id || existing.get(r.id)?.asset_id === r.asset_id) continue;
    await logActivity(r.asset_id, STABLE, [{ kind: "mail", summary: `Paper mail arrived from ${r.from_name || "an unknown sender"}`, detail: { mailId: r.id } }]);
  }
  return rows.length;
}

/** Catch up on anything a webhook missed: the last `days` of mail. */
export async function syncStable(days = 7): Promise<number> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  return saveMail(await listMailSince(since));
}
