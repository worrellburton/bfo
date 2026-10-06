import { Link, useLocation } from "react-router";
import { useTheme } from "../theme";

export function meta() {
  return [{ title: "BFO - Not found" }];
}

/** Any unknown address inside the app — keeps the nav, offers a way on. */
export default function NotFound() {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const { pathname } = useLocation();
  const muted = isDark ? "text-gray-400" : "text-gray-500";
  const chip = `rounded-full border px-4 py-2 text-sm transition-colors ${
    isDark ? "border-white/10 text-gray-200 hover:bg-white/10" : "border-gray-200 text-gray-700 hover:bg-gray-100"
  }`;
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center text-center">
      <p className={`font-mono text-[13px] ${muted}`}>404</p>
      <h1 className="mt-2 text-[22px] font-semibold">This page isn't here</h1>
      <p className={`mt-2 text-sm ${muted}`}>
        <span className="font-mono">{pathname}</span> doesn't exist — it may have moved when the tools were retired.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <Link to="/home" className={chip}>Home</Link>
        <Link to="/assets" className={chip}>Entities</Link>
        <Link to="/books/transactions" className={chip}>Books</Link>
        <Link to="/treasury" className={chip}>Treasury</Link>
      </div>
      <p className={`mt-6 text-xs ${muted}`}>Tip: press ⌘K (or tap the search icon) to jump anywhere.</p>
    </div>
  );
}
