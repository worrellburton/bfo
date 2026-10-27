/**
 * Building PostgREST filter values from text that came from a person or an
 * outside service. A raw value in a query string can change the query's
 * shape: a comma or parenthesis ends an in.(…) or or=(…) list, and `%`/`_`
 * are LIKE wildcards. Everything here is URL-encoded on the way out.
 */

/**
 * A search term for an ilike filter, to be wrapped as `*${likeTerm(q)}*`.
 * LIKE metacharacters (`\`, `%`, `_`) are escaped so they match literally;
 * commas, parentheses and typed `*` — PostgREST list structure — become
 * wildcards, so "Burton, Robert" still matches across the punctuation.
 * Returns "" when nothing searchable is left.
 */
export function likeTerm(raw: string): string {
  const safe = String(raw ?? "")
    .replace(/[,()*]/g, "*")
    .replace(/([\\%_])/g, "\\$1")
    .trim();
  return safe ? encodeURIComponent(safe) : "";
}

/** One value quoted for a PostgREST list or condition: `"` and `\` escaped, then URL-encoded. */
export function pgQuoted(value: string): string {
  return encodeURIComponent(`"${String(value).replace(/[\\"]/g, (c) => `\\${c}`)}"`);
}

/** The body of an in.(…) list: every value quoted, so commas and parentheses inside them stay literal. */
export function inList(values: Iterable<string>): string {
  return [...values].map(pgQuoted).join(",");
}
