import { useCallback, useEffect, useRef, useState } from "react";
import { formatPhone } from "../../lib/sms-inbound";
import { authFetch, isAdmin } from "../auth";
import { Button, Icon, useTone } from "../entity/ui";

export function meta() {
  return [{ title: "BFO - Phone" }];
}

type Text = { id: string; from: string; to: string | null; body: string; code: string | null; receivedAt: string; readAt: string | null };

const changed = () => window.dispatchEvent(new Event("bfo-texts-changed"));

/** "just now", "4 min ago", "2:14 PM", "Oct 21, 2:14 PM". */
function when(iso: string, now: number): string {
  const t = Date.parse(iso);
  const mins = Math.round((now - t) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const d = new Date(t);
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  if (new Date(now).toDateString() === d.toDateString()) return time;
  return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(d.getFullYear() === new Date(now).getFullYear() ? {} : { year: "numeric" }) })}, ${time}`;
}

/**
 * Phone: BFO's own number (Bird, toll-free) and the texts it receives: verification codes for the office's
 * accounts above all. New ones show within seconds; a code is pulled out with
 * a button to copy it. Owners and admins only.
 */
export default function PhonePage() {
  const t = useTone();
  const [texts, setTexts] = useState<Text[] | null>(null);
  const [number, setNumber] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const seen = useRef(new Set<string>());

  const load = useCallback(async () => {
    try {
      const r = await authFetch("/api/texts");
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.message || "Couldn't load texts.");
      setTexts(j.texts ?? []);
      setNumber(j.number ?? null);
      setError("");
      setNow(Date.now());
    } catch (err) {
      setError((err as Error).message);
      setTexts((x) => x ?? []);
    }
  }, []);

  // New texts show up while the page is open (codes are only good for minutes).
  useEffect(() => {
    void load();
    const id = window.setInterval(() => document.visibilityState === "visible" && void load(), 8000);
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);

  // What's on screen counts as read, a moment after it shows.
  useEffect(() => {
    const fresh = (texts ?? []).filter((x) => !x.readAt && !seen.current.has(x.id));
    if (!fresh.length || document.visibilityState !== "visible") return;
    const timer = window.setTimeout(() => {
      fresh.forEach((x) => seen.current.add(x.id));
      void authFetch("/api/texts", { method: "POST", body: JSON.stringify({ action: "read", ids: fresh.map((x) => x.id) }) })
        .then(changed)
        .catch(() => {});
    }, 2500);
    return () => window.clearTimeout(timer);
  }, [texts]);

  async function copy(key: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1600);
    } catch {
      // It's on screen to copy by hand.
    }
  }

  if (!isAdmin()) {
    return (
      <div className="mx-auto max-w-[900px]">
        <p className={`rounded-2xl border px-5 py-5 text-[13px] ${t.surface} ${t.muted}`}>Only an owner or admin sees the office's texts.</p>
      </div>
    );
  }

  const shown = number ? formatPhone(number) : "";
  return (
    <div className="mx-auto max-w-[900px] space-y-4">
      <h1 className={`pt-1 text-[20px] font-semibold tracking-[-0.015em] sm:text-[22px] ${t.text}`}>Phone</h1>

      <section className={`rounded-2xl border p-5 sm:p-6 ${t.surface}`}>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <p className={`text-[11px] font-semibold uppercase tracking-[0.16em] ${t.muted}`}>Our number</p>
            <p className={`mt-1.5 font-brand text-[24px] tabular-nums sm:text-[28px] ${t.text}`}>{shown || "—"}</p>
            <p className={`mt-1 text-[12.5px] ${t.muted}`}>Texts to this number show up here within seconds. Toll-free, through Bird.</p>
          </div>
          {number && (
            <Button icon={copied === "number" ? "check" : "copy"} onClick={() => void copy("number", number)}>
              {copied === "number" ? "Copied" : "Copy number"}
            </Button>
          )}
        </div>
      </section>

      <section className={`overflow-hidden rounded-2xl border ${t.surface}`}>
        <header className={`flex min-h-[48px] items-center justify-between gap-3 border-b px-5 py-3 ${t.line}`}>
          <h2 className={`text-[13.5px] font-semibold ${t.text}`}>Texts</h2>
          {texts && texts.length > 0 && <span className={`text-[12px] tabular-nums ${t.muted}`}>{texts.length === 200 ? "Latest 200" : texts.length}</span>}
        </header>
        {texts === null ? (
          <p className={`px-5 py-5 text-[12.5px] ${t.muted}`}>Loading…</p>
        ) : texts.length === 0 ? (
          <div className={`px-5 py-6 text-[13px] leading-relaxed ${t.muted}`}>
            {error || (
              <>
                <p className={`font-medium ${t.text}`}>No texts yet.</p>
                <p className="mt-1">
                  Each text to {shown || "the number"} shows up here. If one doesn't, check that the BFO webhook in Bird (Developers → Webhooks, pointing at
                  <code className="mx-1">/api/mail-webhook</code>) has the <code>sms.received</code> event ticked.
                </p>
              </>
            )}
          </div>
        ) : (
          <ul className={`divide-y ${t.dark ? "divide-white/[0.06]" : "divide-gray-100"}`}>
            {texts.map((x) => (
              <li key={x.id} className="flex items-start gap-3 px-5 py-4">
                <span
                  aria-hidden="true"
                  className={`mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full ${!x.readAt && !seen.current.has(x.id) ? "bg-[#818cf8]" : "bg-transparent"}`}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                    <span className={`text-[13.5px] font-medium tabular-nums ${t.text}`}>{formatPhone(x.from)}</span>
                    <span className={`text-[12px] tabular-nums ${t.muted}`} title={new Date(x.receivedAt).toLocaleString()}>
                      {when(x.receivedAt, now)}
                    </span>
                  </div>
                  <p className={`mt-1 whitespace-pre-wrap break-words text-[13px] leading-relaxed ${t.soft}`}>{x.body || <span className={t.faint}>(no text)</span>}</p>
                  {x.code && (
                    <div className="mt-2.5 flex flex-wrap items-center gap-2">
                      <span className={`rounded-lg border px-2.5 py-1 font-mono text-[17px] font-semibold tracking-[0.12em] tabular-nums ${t.line} ${t.text}`}>{x.code}</span>
                      <Button icon={copied === x.id ? "check" : "copy"} onClick={() => void copy(x.id, x.code!)}>
                        {copied === x.id ? "Copied" : "Copy code"}
                      </Button>
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      {error && texts && texts.length > 0 && (
        <p className={`flex items-center gap-1.5 text-[12px] ${t.muted}`}>
          <Icon name="refresh" className="h-3 w-3" />
          {error}
        </p>
      )}
    </div>
  );
}
