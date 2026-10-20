import { sb } from "./auth.js";
import { storageUpload } from "./storage.js";
import { readCollection } from "./tree.js";

/**
 * Stable (usestable.com): the family's mailbox at 5227 N 7th St, Phoenix.
 * Each piece of paper mail is copied into public.stable_mail, with its
 * envelope photo and, once scanned, its contents kept in the private "mail"
 * bucket (Stable's links expire), and tied to the BFO entity it's addressed
 * to. A webhook says something changed; the API is what's believed.
 *
 * STABLE_API_KEY: Stable → Settings → API keys.
 */

const BASE = "https://api.usestable.com";

export class StableNotConfigured extends Error {}

export async function stable<T>(path: string): Promise<T> {
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
};

type Page = { edges?: { node: StableMailItem; cursor?: string }[]; pageInfo?: { hasNextPage?: boolean; endCursor?: string | null } };

/** Mail items received since `since` (ISO), newest pages followed to the end. */
export async function listMailSince(since: string, max = 500): Promise<StableMailItem[]> {
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

/** "Ledger Louise, L.L.C." → "ledger louise": compared without punctuation or the entity ending. */
export function normName(s: string | null | undefined): string {
  return (s ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\b(l ?l ?c|inc|incorporated|corp|corporation|co|company|ltd|lp|l ?p|llp|pllc|trust|the)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The entity whose name the envelope carries: the matched business, then each address line. */
export function matchEntity(item: StableMailItem, entities: { id: string; name: string }[]): string | null {
  const byName = new Map(entities.map((e) => [normName(e.name), e.id] as const).filter(([n]) => n));
  const lines = [item.recipients?.business?.name, item.recipients?.line1?.text, item.recipients?.line2?.text, item.businessRecipient];
  for (const line of lines) {
    const n = normName(line);
    if (n && byName.has(n)) return byName.get(n)!;
  }
  // "Swisshelm Mountain Ventures LLC c/o Robert Burton": an entity name inside a longer line.
  for (const line of lines) {
    const n = ` ${normName(line)} `;
    const hit = [...byName.entries()].filter(([name]) => name.length >= 6 && n.includes(` ${name} `)).sort((a, b) => b[0].length - a[0].length)[0];
    if (hit) return hit[1];
  }
  return null;
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
      asset_id: prev?.assigned === "hand" ? prev.asset_id : matchEntity(item, list) ?? prev?.asset_id ?? null,
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
  return rows.length;
}

/** Catch up on anything a webhook missed: the last `days` of mail. */
export async function syncStable(days = 7): Promise<number> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  return saveMail(await listMailSince(since));
}
