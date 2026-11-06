import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { authFetch, canWrite } from "../auth";
import { accountShort, displayName, memoText, txnCount } from "../books-shared";
import { Banner, Button, Card, Disclosure, Empty, IconButton, List, ListRow, Page, PageHeader, SearchField, Skeleton, Table, confirm, format, toast, useDocumentTitle, usePhone, type Column } from "../ui";

export function meta() {
  return [{ title: "Rules · BFO" }];
}

type Rule = {
  id: string;
  position?: number;
  match: string;
  match_kind?: "vendor" | "contains";
  book_category: string | null;
  vendor_name: string | null;
  type_override: string | null;
  loan_id: string | null;
  loan_name?: string | null;
  matches: number;
  filed?: number | null;
  created_at: string;
  created_by_name?: string | null;
  reason?: string | null;
  overlaps?: Array<{ id: string; match: string; wins: boolean }>;
};
type BuiltIn = { match: string; category: string | null; type: string | null; payeeOnly: boolean; plaid: string | null };

const TYPE_WORDS: Record<string, string> = { normal: "Mark as income or expense", transfer: "Mark as a transfer", intercompany: "Mark as intercompany" };

/** What a rule does, as verbs. */
function effects(r: Pick<Rule, "book_category" | "vendor_name" | "type_override" | "loan_id" | "loan_name">): string[] {
  const out: string[] = [];
  if (r.book_category) out.push(`File under ${accountShort(r.book_category)}`);
  if (r.vendor_name) out.push(`Rename to ${r.vendor_name}`);
  if (r.type_override) out.push(TYPE_WORDS[r.type_override] ?? r.type_override);
  if (r.loan_id) out.push(r.loan_name ? `Attach to the loan ${r.loan_name}` : "Attach to a loan");
  return out;
}

/** A rule's text as people read it: shouting cased, references dropped. */
const matchText = (m: string) => memoText(m) || displayName(m) || m;

/**
 * What the books have learned: every rule a person taught (by "apply to
 * all", a vendor's default or name, a merge, or a loan's auto-attach), in
 * the order they're tried, with how many transactions each reaches and
 * which other rules reach the same ones. The built-in chart follows.
 */
export default function BooksRules() {
  useDocumentTitle("Rules");
  const phone = usePhone();
  const writable = canWrite();
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [builtIn, setBuiltIn] = useState<BuiltIn[]>([]);
  const [ordered, setOrdered] = useState(false);
  const [q, setQ] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const res = await authFetch("/api/books/ledger?report=rules");
      if (res.ok) {
        const d = await res.json();
        setRules(d.rules ?? []);
        setBuiltIn(d.built_in ?? []);
        setOrdered(true);
        return;
      }
      // An older server: the plain list.
      const old = await authFetch("/api/books/data?report=rules");
      if (!old.ok) throw new Error();
      setRules(((await old.json()).rules ?? []) as Rule[]);
    } catch {
      setError("Couldn’t load the rules.");
      setRules([]);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function remove(r: Rule) {
    const ok = await confirm({
      title: "Delete this rule?",
      object: { name: matchText(r.match), detail: [effects(r).join(" · "), `reaches ${txnCount(r.matches)}`].filter(Boolean).join(" · ") },
      message: "New transactions stop following it. The ones it already filed keep their account and their history. You can undo this right after.",
      confirmLabel: "Delete rule",
      tone: "danger",
    });
    if (!ok) return;
    const before = rules;
    setRules((prev) => (prev ?? []).filter((x) => x.id !== r.id));
    const res = await authFetch("/api/books/data", { method: "POST", body: JSON.stringify({ action: "delete_rule", rule_id: r.id }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setRules(before);
      setError(res.status === 403 ? "You have view-only access to Books." : "Couldn’t delete that rule.");
      return;
    }
    const saved = (data.rule ?? r) as Rule;
    toast({
      message: `Deleted the rule “${matchText(r.match)}”`,
      action: {
        label: "Undo",
        run: () =>
          void authFetch("/api/books/ledger", { method: "POST", body: JSON.stringify({ action: "restore_rule", rule: saved }) }).then((x) => {
            toast({ message: x.ok ? "Rule restored" : "Couldn’t restore the rule. Teach it again from a transaction." });
            void load();
          }),
      },
    });
  }

  const needle = q.trim().toLowerCase();
  const shown = useMemo(() => (rules ?? []).filter((r) => !needle || r.match.toLowerCase().includes(needle) || effects(r).join(" ").toLowerCase().includes(needle)), [rules, needle]);
  const overlapping = (rules ?? []).filter((r) => r.overlaps && r.overlaps.length > 0).length;

  const matchesLink = (r: Rule) => (
    <Link to={`/books/transactions?q=${encodeURIComponent(r.match)}`} className="text-accent tabular-nums hover:underline">
      {r.matches.toLocaleString("en-US")}
    </Link>
  );
  const columns: Column<Rule>[] = [
    ...(ordered ? [{ key: "pos", header: "Order", width: "64px", render: (r: Rule) => <span className="text-ink-2 tabular-nums">{r.position}</span> }] : []),
    {
      key: "match",
      header: "When the payee",
      render: (r) => (
        <span title={r.match}>
          <span className="text-ink-2">{r.match_kind === "vendor" ? "is " : "contains "}</span>
          {matchText(r.match)}
          {r.overlaps && r.overlaps.length > 0 && (
            <span className="block text-small text-warning">
              Also reached by {r.overlaps.map((o) => `“${matchText(o.match)}”${o.wins ? " (tried first)" : ""}`).join(", ")}
            </span>
          )}
        </span>
      ),
    },
    { key: "do", header: "Do this", width: "28%", render: (r) => effects(r).join(" · ") || <span className="text-ink-3">Nothing</span> },
    { key: "matches", header: "Reaches", align: "right", width: "96px", sort: (a, b) => a.matches - b.matches, render: matchesLink },
    { key: "added", header: "Added", width: "160px", sort: (a, b) => a.created_at.localeCompare(b.created_at), render: (r) => <span className="text-small text-ink-2">{[format.date(r.created_at, "short"), r.created_by_name].filter(Boolean).join(" · ")}</span> },
    ...(writable
      ? [
          {
            key: "act",
            header: "",
            width: "56px",
            render: (r: Rule) => (
              <span className="inline-flex [@media(hover:hover)]:opacity-0 [tr:hover_&]:opacity-100 focus-within:opacity-100">
                <IconButton icon="trash" label={`Delete rule “${matchText(r.match)}”`} onClick={() => void remove(r)} />
              </span>
            ),
          },
        ]
      : []),
  ];

  const context = rules ? `${format.count(rules.length, "rule", "rules")}${ordered ? " · tried top to bottom; a payee’s exact name before words in it, then the longer text" : ""}${overlapping ? ` · ${overlapping} overlap` : ""}` : undefined;
  return (
    <Page width="workspace" header={<PageHeader title="Rules" context={context} />}>
      {error && <Banner tone="negative" action={<Button variant="quiet" size="sm" onClick={() => void load()}>Try again</Button>}>{error}</Banner>}
      <p className="max-w-[68ch] text-body text-ink-2">Rules are made when you file a payee’s transactions all at once, set a vendor’s default, rename or merge a vendor, or auto-attach a loan. They decide how new transactions are filed, before the built-in chart. Each change a rule makes is recorded in that transaction’s history.</p>
      <Card flush>
        <div className="px-5 py-3 touch:px-4">
          <SearchField value={q} onChange={setQ} placeholder="Search rules" label="Search rules" />
        </div>
        <div className="border-t border-line">
          {!rules ? (
            <Skeleton kind={phone ? "rows" : "table"} rows={8} />
          ) : phone ? (
            shown.length ? (
              <List label="Rules">
                {shown.map((r) => (
                  <ListRow
                    key={r.id}
                    title={`${r.match_kind === "vendor" ? "Is" : "Contains"} ${matchText(r.match)}`}
                    secondary={[effects(r).join(" · "), `reaches ${r.matches}`].join(" · ")}
                    to={`/books/transactions?q=${encodeURIComponent(r.match)}`}
                    menu={writable ? [{ label: "Delete rule…", danger: true, onSelect: () => void remove(r) }] : undefined}
                  />
                ))}
              </List>
            ) : (
              <div className="px-4 py-4">
                <Empty size="section">{rules.length ? `No rules match “${q}”.` : "No rules yet. File a payee’s transactions all at once to teach the first one."}</Empty>
              </div>
            )
          ) : (
            <Table
              caption="Rules"
              columns={columns}
              rows={shown}
              rowKey={(r) => r.id}
              phoneRow={(r) => ({ title: matchText(r.match) })}
              empty={<Empty size="section">{rules.length ? `No rules match “${q}”.` : "No rules yet. File a payee’s transactions all at once to teach the first one."}</Empty>}
            />
          )}
        </div>
      </Card>
      {builtIn.length > 0 && (
        <Card title="Built into the books" flush info="Tried after the rules above, in this order. They can’t be changed here; a rule above overrides them.">
          <div className="px-5 pb-4 touch:px-4">
            <Disclosure label="Show the built-in rules" count={builtIn.length}>
              <ul className="mt-2 flex flex-col">
                {builtIn.map((b, i) => (
                  <li key={i} className="border-b border-line py-2 text-body last:border-b-0">
                    <span className="text-ink-2">{b.payeeOnly ? "When the payee names " : "When it mentions "}</span>
                    {b.match}
                    {b.plaid ? <span className="text-ink-2"> (bank category {b.plaid})</span> : null}
                    <span className="block text-small text-ink-2">{b.category ? `File under ${accountShort(b.category)}` : "Leave for a person to decide"}</span>
                  </li>
                ))}
              </ul>
            </Disclosure>
          </div>
        </Card>
      )}
    </Page>
  );
}
