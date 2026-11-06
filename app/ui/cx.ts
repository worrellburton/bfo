/** Joins class names, dropping the falsy ones: cx("a", on && "b"). Used by every app/ui component. */
export function cx(...parts: Array<string | false | null | undefined | 0>): string {
  return parts.filter(Boolean).join(" ");
}
