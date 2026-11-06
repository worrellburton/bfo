import { ErrorPage, useDocumentTitle } from "../ui";

export function meta() {
  return [{ title: "Page not found · BFO" }];
}

/**
 * Any unknown address inside the app (docs/DESIGN.md §8.18): the shell stays,
 * so the nav is there, and the page offers one way on, Home, and search.
 * The root error boundary (app/root.tsx) draws the same page.
 */
export default function NotFound() {
  useDocumentTitle("Page not found");
  return <ErrorPage kind="not-found" />;
}
