import type { Actor } from "./activity.js";
import { raPatch, type RaServiceLike } from "./palm-agent.js";
import { docKindOf, palmDocKey, palmDocName, PALM_SLOT } from "./palm-docs.js";
import { businessDifferences, listPalmDocuments, palm, PalmError, palmFile, palmMode, type PalmDocumentRow } from "./palm.js";
import { checkStateRecords, type CheckResult } from "./state-records.js";
import { storageUpload } from "./storage.js";
import { applyOps, readCollection, readRows, type Json } from "./tree.js";

/**
 * "Sync everything with Palm" for every entity at once (the Entities page):
 * each one's state records (home and foreign; the billed part), then, for the
 * ones linked to a Palm business, its agent, Palm's copy of the business, its
 * mail (saved to Documents, live mode only) and Palm's open questions. The
 * same reads the entity page's sync makes, run on the server so it doesn't
 * depend on a page staying open. Reads and fills blanks; never files.
 */

export type SyncLine = { label: string; tone: "good" | "warn" | "bad" | "muted"; text: string };
export type EntitySync = { id: string; name: string; lines: SyncLine[] };

type Data = {
  name?: string;
  type?: string;
  documents?: Record<string, { palmDocumentId?: string } | null>;
  palm?: Record<string, { businessId?: string | null; formation?: { filingId?: string; ein?: { filingId?: string } | null } | null } | undefined>;
  [k: string]: unknown;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATE_LINE: Record<CheckResult["outcome"], SyncLine["tone"]> = { read: "good", fresh: "good", not_found: "warn", ambiguous: "warn", error: "bad", later: "warn" };

/** A state record read more recently than this is kept by "Sync all", not read (and billed) again. */
export const SYNC_FRESH_MS = 24 * 60 * 60 * 1000;

const safeSegment = (s: string) => s.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");

/** One Palm document saved to the entity's Documents (and its empty slot), as the page saves one. */
async function saveDocument(assetId: string, data: Data, d: PalmDocumentRow, actor: Actor): Promise<boolean> {
  // Keyed by Palm's id (as the page keys it), and looked for again just before saving: the page, a tab or
  // another sync may have saved it since this run read the entity.
  const key = palmDocKey(d.id);
  const now0 = ((await readRows("assets", [assetId]))[0]?.data ?? {}) as Data;
  if (now0.documents?.[key] || Object.values(now0.documents ?? {}).some((x) => x?.palmDocumentId === d.id)) return false;
  const file = await palmFile(`/v1/document/${d.id}/content`);
  const name = palmDocName(d);
  const contentType = file.contentType || "application/pdf";
  const path = `assets/${safeSegment(assetId)}/${Date.now()}-${safeSegment(name)}`;
  await storageUpload(path, new Uint8Array(file.bytes), contentType, "documents");
  // The legacy URL shape is kept on the record; reads go by `storagePath` through signed links.
  const url = `${(process.env.SUPABASE_URL ?? "").replace(/\/$/, "")}/storage/v1/object/public/documents/${path}`;
  const now = Date.now();
  const kind = docKindOf(d);
  const patch: Record<string, unknown> = {
    [`documents/${key}`]: {
      name: name.replace(/\.[^.]+$/, ""),
      url,
      storagePath: path,
      storageProvider: "supabase",
      size: file.bytes.length,
      contentType,
      createdAt: now,
      palmDocumentId: d.id,
      ...(kind ? { palmType: kind } : {}),
    },
  };
  const slot = [kind, ...(d.types ?? []), d.type ?? ""].map((k) => PALM_SLOT[k]).find(Boolean);
  // The slot as it is now (the page may have filled it since this run read the entity), or as this run filled it.
  if (slot && !now0[slot] && !data[slot]) {
    patch[slot] = { url, fileName: name, size: file.bytes.length, contentType, uploadedAt: now, storagePath: "", docId: key };
    data[slot] = true; // two of the same kind fill the slot once
  }
  await applyOps([{ op: "update", path: ["assets", assetId], value: patch as Json }], actor);
  return true;
}

export async function syncAllWithPalm(opts: { ids?: string[]; by: { id: string; name: string | null }; budgetMs?: number; now?: () => number }): Promise<{ mode: "test" | "live"; entities: EntitySync[] }> {
  const mode = palmMode();
  if (!mode) throw new Error("Palm isn't connected.");
  const clock = opts.now ?? Date.now;
  const started = clock();
  const budget = opts.budgetMs ?? 240_000;
  const actor: Actor = { id: opts.by.id, name: opts.by.name, source: "user" };
  const out = new Map<string, EntitySync>();
  const lineFor = (id: string, name: string) => out.get(id) ?? out.set(id, { id, name, lines: [] }).get(id)!;

  // 1. Every state record, home and foreign, read now (the billed part).
  // Records read in the last day are kept (a second click doesn't bill again), and reading stops in time
  // for the rest of the run; whatever's left is read next time.
  const states = await checkStateRecords({ ids: opts.ids, freshMs: SYNC_FRESH_MS, deadline: started + budget * 0.6, by: opts.by });
  for (const r of states) {
    const text =
      r.outcome === "read" ? `Read${r.detail ? ` · ${r.detail}` : ""}`
      : r.outcome === "not_found" ? "No registry entry matched the name. Add its file number under Edit."
      : r.outcome === "ambiguous" ? "More than one registry entry matched. Pick the right one on its Compliance tab."
      : r.outcome === "error" ? r.detail ?? "Couldn't reach Palm."
      : r.outcome === "later" ? "Not read this time (out of time); sync again to read it."
      : "Read in the last day; kept.";
    lineFor(r.id, r.name).lines.push({ label: `${r.state} record`, tone: STATE_LINE[r.outcome], text });
  }

  // 2. Each entity Palm holds: its agent, Palm's copy, its mail, its open questions.
  const rows = (await readCollection("assets")).filter((r) => !opts.ids || opts.ids.includes(r.id));
  for (const row of rows) {
    const data = (row.data ?? {}) as Data;
    if (!data.name || data.type === "Trust") continue;
    const entry = lineFor(row.id, data.name);
    const link = data.palm?.[mode];
    const businessId = link?.businessId && UUID.test(link.businessId) ? link.businessId : null;
    if (!businessId) {
      entry.lines.push({ label: "Agent and mail", tone: "muted", text: "Not in Palm yet." });
      continue;
    }
    if (clock() - started > budget) {
      entry.lines.push({ label: "Agent and mail", tone: "warn", text: "Out of time on this run; sync again to finish." });
      continue;
    }
    const say = (line: SyncLine) => entry.lines.push(line);
    const patch: Record<string, unknown> = {};

    try {
      let service: RaServiceLike | null = null;
      try {
        service = await palm<RaServiceLike>(`/v1/business/${businessId}/registered-agent`);
      } catch (err) {
        if (!(err instanceof PalmError && err.status === 404)) throw err;
      }
      Object.assign(patch, raPatch(data as Parameters<typeof raPatch>[0], service, mode, clock()));
      say({ label: "Registered agent", tone: service?.status === "active" ? "good" : service?.status ? "warn" : "muted", text: service?.status ? service.status.replace(/_/g, " ") : "Palm isn't its agent." });
    } catch (err) {
      say({ label: "Registered agent", tone: "bad", text: (err as Error).message });
    }

    try {
      const business = await palm<{ display_name?: string | null; metadata?: Record<string, string>; vault?: Record<string, unknown> | null }>(`/v1/business/${businessId}`);
      if (business?.metadata?.bfo_asset_id !== row.id) {
        say({ label: "Palm's copy", tone: "bad", text: "That Palm business isn't linked to this entity." });
      } else {
        const ours = data as { name?: string; ein?: string; fileNumber?: string; formationDate?: string; address?: string };
        if (ours.name?.trim() && business.display_name !== ours.name.trim()) await palm(`/v1/business/${businessId}`, { method: "PATCH", body: { display_name: ours.name.trim() } });
        const diff = businessDifferences(business.vault ?? {}, ours);
        patch[`palm/${mode}/business`] = { differences: diff, checkedAt: clock() };
        say({ label: "Palm's copy", tone: diff.length ? "warn" : "good", text: diff.length ? `${diff.map((d) => `${d.field}: Palm has ${d.palm}, ours is ${d.ours}.`).join(" ")} Correct these in Palm Console.` : "Matches our record." });
      }
    } catch (err) {
      say({ label: "Palm's copy", tone: "bad", text: (err as Error).message });
    }

    try {
      const { documents, truncated } = await listPalmDocuments(businessId);
      let saved = 0;
      let left = 0;
      if (mode === "live") {
        const have = new Set(Object.values(data.documents ?? {}).map((d) => d?.palmDocumentId).filter(Boolean));
        const missing = documents.filter((d) => !have.has(d.id)).sort((a, b) => String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")));
        for (const d of missing) {
          if (clock() - started > budget) {
            left++;
            continue;
          }
          try {
            if (await saveDocument(row.id, data, d, actor)) saved++;
          } catch (err) {
            console.error("palm-sync: couldn't save a document", row.id, d.id, err);
            left++;
          }
        }
      }
      say({
        label: "Mail",
        tone: left ? "warn" : "good",
        text: !documents.length
          ? "No documents at Palm."
          : `${documents.length} at Palm${mode === "live" ? `; ${saved} newly saved to Documents${left ? `, ${left} left for the next sync` : ""}` : " (test mode: not saved)"}${truncated ? ". More than 10,000: the oldest weren't read." : "."}`,
      });
    } catch (err) {
      say({ label: "Mail", tone: "bad", text: (err as Error).message });
    }

    try {
      const parents: [string, string][] = [["business", businessId]];
      if (link?.formation?.filingId) parents.push(["filing", link.formation.filingId]);
      if (link?.formation?.ein?.filingId) parents.push(["filing", link.formation.ein.filingId]);
      const lists = await Promise.all(parents.filter(([, id]) => UUID.test(id)).map(([type, id]) => palm<{ data?: { id: string; status: string }[] } | { id: string; status: string }[]>(`/v1/case?parent_type=${type}&parent_id=${id}`).catch(() => null)));
      const waiting = new Set(lists.flatMap((l) => (Array.isArray(l) ? l : l?.data ?? [])).filter((c) => c?.status === "needs_response").map((c) => c.id)).size;
      say({ label: "Palm's questions", tone: waiting ? "warn" : "good", text: waiting ? `${waiting} waiting on an answer (Compliance).` : "None open." });
    } catch (err) {
      say({ label: "Palm's questions", tone: "bad", text: (err as Error).message });
    }

    patch[`palm/${mode}/syncedAt`] = clock();
    await applyOps([{ op: "update", path: ["assets", row.id], value: patch as Json }], actor).catch((err) => say({ label: "Saving", tone: "bad", text: (err as Error).message }));
  }

  return { mode, entities: [...out.values()].sort((a, b) => a.name.localeCompare(b.name)) };
}
