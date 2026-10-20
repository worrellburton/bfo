import { useEffect, useMemo, useState } from "react";
import { Button, useTone } from "../entity/ui";
import { paperAction, PaperMailList, STABLE_ADDRESS, STABLE_DASHBOARD, usePaperMail, type PaperMail } from "../paper-mail";

export function meta() {
  return [{ title: "BFO - Paper mail" }];
}

type Filter = "all" | "unread" | "unassigned";

/**
 * Every piece of paper mail that arrives at the Stable address, newest first.
 * Each is filed under the entity on its envelope; a piece BFO couldn't match
 * waits here for someone to choose.
 */
export default function PaperMailPage() {
  const t = useTone();
  const { mail, setMail, configured, error, reload } = usePaperMail();
  const [entities, setEntities] = useState<{ id: string; name: string }[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [syncing, setSyncing] = useState(false);
  const [note, setNote] = useState("");

  useEffect(() => {
    void (async () => {
      const { db, ref, get, authReady } = await import("../store");
      await authReady;
      const all = ((await get(ref(db, "assets"))).val() ?? {}) as Record<string, { name?: string }>;
      setEntities(Object.entries(all).map(([id, a]) => ({ id, name: a?.name ?? id })).sort((a, b) => a.name.localeCompare(b.name)));
    })().catch(() => {});
  }, []);

  const shown = useMemo(() => {
    const list = mail ?? [];
    if (filter === "unread") return list.filter((m) => !m.readAt);
    if (filter === "unassigned") return list.filter((m) => !m.assetId);
    return list;
  }, [mail, filter]);
  const counts = { unread: (mail ?? []).filter((m) => !m.readAt).length, unassigned: (mail ?? []).filter((m) => !m.assetId).length };

  async function sync() {
    setSyncing(true);
    setNote("");
    try {
      const r = await paperAction({ action: "sync", days: 30 });
      await reload();
      setNote(r.synced ? `Checked Stable: ${r.synced} piece${r.synced === 1 ? "" : "s"} from the last 30 days.` : "Checked Stable: nothing new.");
    } catch (err) {
      setNote((err as Error).message);
    } finally {
      setSyncing(false);
    }
  }

  async function assign(m: PaperMail, assetId: string | null) {
    setMail((list) => list?.map((x) => (x.id === m.id ? { ...x, assetId, assigned: "hand" } : x)) ?? list);
    try {
      await paperAction({ action: "assign", id: m.id, assetId });
    } catch (err) {
      setNote((err as Error).message);
      void reload();
    }
  }

  function opened(m: PaperMail) {
    if (m.readAt) return;
    setMail((list) => list?.map((x) => (x.id === m.id ? { ...x, readAt: new Date().toISOString() } : x)) ?? list);
    void paperAction({ action: "read", id: m.id }).catch(() => {});
  }

  return (
    <div className="mx-auto max-w-[1100px] space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3 pt-1">
        <div className="min-w-0">
          <h1 className={`text-[20px] font-semibold tracking-[-0.015em] sm:text-[22px] ${t.text}`}>Paper mail</h1>
          <p className={`mt-1 text-[12.5px] ${t.muted}`}>{STABLE_ADDRESS} · through Stable</p>
        </div>
        <div className="flex items-center gap-2">
          <a href={STABLE_DASHBOARD} target="_blank" rel="noopener noreferrer" className={`text-[12.5px] font-medium hover:underline ${t.accent}`}>
            Open Stable
          </a>
          <Button icon="refresh" onClick={() => void sync()} disabled={syncing || !configured}>
            {syncing ? "Checking…" : "Check now"}
          </Button>
        </div>
      </header>

      {!configured && (
        <div className={`rounded-2xl border p-5 text-[13px] leading-relaxed ${t.surface} ${t.soft}`}>
          <p className={`font-semibold ${t.text}`}>Connect Stable</p>
          <p className="mt-1">
            In Stable, create an API key under Settings → API keys and add it in Vercel as <code>STABLE_API_KEY</code>. For mail to show up the moment it arrives, add a webhook under
            Settings → Webhooks pointing at <code>/api/stable-webhook?token=…</code> with the token in Vercel as <code>STABLE_WEBHOOK_TOKEN</code>. Until then, BFO checks every hour.
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        {(
          [
            ["all", "All", mail?.length ?? 0],
            ["unread", "Unread", counts.unread],
            ["unassigned", "Needs an entity", counts.unassigned],
          ] as [Filter, string, number][]
        ).map(([key, label, n]) => (
          <button
            key={key}
            type="button"
            onClick={() => setFilter(key)}
            aria-pressed={filter === key}
            className={`inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-[12.5px] font-medium transition-colors ${
              filter === key ? (t.dark ? "border-white/20 bg-white/[0.08] text-white" : "border-gray-900 bg-gray-900 text-white") : `${t.line} ${t.soft}`
            }`}
          >
            {label}
            {n > 0 && <span className={`tabular-nums ${filter === key ? "opacity-80" : t.muted}`}>{n}</span>}
          </button>
        ))}
        {note && <span className={`ml-2 text-[12px] ${t.muted}`}>{note}</span>}
      </div>

      <section className={`overflow-hidden rounded-2xl border ${t.surface}`}>
        {mail === null ? (
          <p className={`px-5 py-5 text-[12.5px] ${t.muted}`}>Loading…</p>
        ) : (
          <PaperMailList
            mail={shown}
            entities={entities}
            onAssign={(m, id) => void assign(m, id)}
            onOpen={opened}
            empty={error || (filter === "all" ? "No paper mail yet. Each piece shows up here as Stable receives it." : filter === "unread" ? "Nothing unread." : "Every piece is filed under an entity.")}
          />
        )}
      </section>
    </div>
  );
}
