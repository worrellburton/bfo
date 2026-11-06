import { money as format } from "./ui/format";

/**
 * Currency formatting shared across the Treasury screens, now through the
 * design system's formatter (app/ui/format.ts, docs/DESIGN.md §10) until
 * those screens call it directly:
 *  - money:  cents with a true minus; an em dash when there is no balance
 *  - signed: an explicit + or − sign, for changes and movements
 */
export const money = (n: number | null | undefined, currency = "USD"): string => (n == null ? "—" : format(n, { currency }));

export const signed = (n: number, currency = "USD"): string => format(n, { currency, sign: "always" });
