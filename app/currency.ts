/**
 * Currency formatting shared across the Treasury screens.
 *  - money:  null-safe currency, an em dash for empty balances
 *  - signed: an explicit +/− sign, for changes and movements
 */
export const money = (n: number | null | undefined, currency = "USD"): string =>
  n == null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency }).format(n);

export const signed = (n: number, currency = "USD"): string =>
  `${n >= 0 ? "+" : "−"}${new Intl.NumberFormat("en-US", { style: "currency", currency }).format(Math.abs(n))}`;
