import { Link, Navigate } from "react-router";
import { getUser } from "../auth";
import { canPreviewGame } from "../sign/preview";
import { useTheme } from "../theme";

export function meta() {
  return [{ title: "Games · BFO" }];
}

/** The games a signer can be sent through, each with a way to play it on a sample document. */
const GAMES = [
  {
    id: "game",
    name: "Anything Is Possible",
    kind: "The movie theater",
    line: "A floating island, a chain of blocks to the theater, Judy at the ticket booth, the seat with your name on it, the film, and the door to the room with the contract.",
    to: "/sign/preview",
  },
  {
    id: "race",
    name: "The Racetrack",
    kind: "Two laps against Judy",
    line: "You drive, Judy rams you, and she talks the whole way. Two laps of about a minute, the music changes for the last one, and on the final stretch something happens to Judy's arm. The signing page is at the finish.",
    to: "/sign/preview?game=race",
  },
];

/**
 * The games, from the account menu ("Games"): what each is, and Play, which
 * runs it as a signer sees it on a sample document and signs nothing
 * (app/routes/sign-preview.tsx). Only the account app/sign/preview.ts names.
 */
export default function Games() {
  const user = getUser();
  const { theme } = useTheme();
  const isDark = theme === "dark";
  if (!canPreviewGame(user)) return <Navigate to="/home" replace />;
  const card = `rounded-2xl border p-5 ${isDark ? "border-white/10 bg-white/[0.02] glass-card" : "border-gray-200 bg-white glass-card"}`;
  const t2 = isDark ? "text-gray-400" : "text-gray-600";
  const t3 = isDark ? "text-gray-500" : "text-gray-400";
  return (
    <div className="mx-auto max-w-[720px] px-4 py-6 sm:px-6">
      <p className={`text-[11px] font-medium uppercase tracking-[0.14em] ${t3}`}>Games</p>
      <h1 className="mt-1 text-[22px] font-semibold tracking-tight">The games a signer can be sent through</h1>
      <p className={`mt-1 text-[13px] ${t2}`}>Each runs as a signer sees it, on a sample document, and signs nothing. A computer with a keyboard is needed.</p>
      <div className="mt-6 space-y-4">
        {GAMES.map((g) => (
          <section key={g.id} className={card}>
            <p className={`text-[11px] uppercase tracking-[0.14em] ${t3}`}>{g.kind}</p>
            <h2 className="mt-1 text-[17px] font-semibold">{g.name}</h2>
            <p className={`mt-2 text-[13px] leading-relaxed ${t2}`}>{g.line}</p>
            <Link
              to={g.to}
              className={`mt-4 inline-flex h-[44px] items-center rounded-xl px-5 text-[13px] font-semibold transition-colors ${isDark ? "bg-white text-black hover:bg-gray-200" : "bg-gray-900 text-white hover:bg-black"}`}
            >
              Play {g.name}
            </Link>
          </section>
        ))}
      </div>
    </div>
  );
}
