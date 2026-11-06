/**
 * Whether two people's names are the same person's, as people type them.
 * Pure, with no imports, so the browser (the closing checklist) and the server
 * (api/sign.ts, matching a signer to a BFO user) share one rule.
 */

/**
 * "Robert Burton" and "Robert W. Burton", "Amanda" and "Amanda Burton Dawson":
 * first and last names must agree; a middle name or initial on both sides
 * must start the same way, so "Robert W. Burton" is not "Robert Ledger Burton".
 */
export function namesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const words = (s: string) =>
    s
      .toLowerCase()
      .replace(/\(.*?\)/g, " ")
      .replace(/[^a-z\s]/g, " ")
      .split(/\s+/)
      .filter(Boolean);
  const x = words(a ?? "");
  const y = words(b ?? "");
  if (!x.length || !y.length) return false;
  if (x.length === 1 || y.length === 1) return x[0] === y[0];
  if (x[0] !== y[0] || x[x.length - 1] !== y[y.length - 1]) return false;
  const mx = x.slice(1, -1);
  const my = y.slice(1, -1);
  return !mx.length || !my.length || mx[0][0] === my[0][0];
}
