import { useEffect, useState } from "react";
import { Link } from "react-router";
import { useTheme } from "../theme";

export function meta() {
  return [
    { title: "BFO" },
    { name: "description", content: "Look, feel and perform your best every day." },
  ];
}

interface Asset {
  id: string;
  name: string;
  type: "LLC" | "C-Corp";
  state?: string;
  ein?: string;
  ownerId?: string;
  createdAt?: number;
  operatingAgreementDate?: string;
  articlesOfOrgDate?: string;
  stateLink?: string;
}

const QUICK_LINKS = [
  {
    to: "/assets",
    title: "Entities",
    desc: "Browse and manage all entities",
    path: "M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21",
  },
  {
    to: "/estate-map",
    title: "Map",
    desc: "Visualize ownership structure",
    path: "M9 6.75V15m6-6v8.25m.503 3.498l4.875-2.437c.381-.19.622-.58.622-1.006V4.82c0-.836-.88-1.38-1.628-1.006l-3.869 1.934c-.317.159-.69.159-1.006 0L9.503 3.252a1.125 1.125 0 00-1.006 0L3.622 5.689C3.24 5.88 3 6.27 3 6.695V19.18c0 .836.88 1.38 1.628 1.006l3.869-1.934c.317-.159.69-.159 1.006 0l4.994 2.497c.317.158.69.158 1.006 0z",
  },
  {
    to: "/tools/quickbooks",
    title: "Finance",
    desc: "QuickBooks financials & reports",
    path: "M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z",
  },
  {
    to: "/tools/taxes",
    title: "Taxes",
    desc: "Tax coordination & packages",
    path: "M9 14.25l6-6m4.5-3.493V21.75l-3.75-1.5-3.75 1.5-3.75-1.5-3.75 1.5V4.757c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0c1.1.128 1.907 1.077 1.907 2.185z",
  },
  {
    to: "/tools",
    title: "Tools",
    desc: "Calculators & utilities",
    path: "M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75",
  },
];

export default function Home() {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    async function setup() {
      const { db, authReady } = await import("../firebase");
      await authReady;
      const { ref, onValue } = await import("firebase/database");
      unsubscribe = onValue(ref(db, "assets"), (snapshot) => {
        const data = snapshot.val();
        if (data) {
          setAssets(
            Object.entries(data).map(([id, value]) => ({
              id,
              ...(value as Omit<Asset, "id">),
            }))
          );
        } else {
          setAssets([]);
        }
        setLoading(false);
      });
    }
    setup();
    return () => unsubscribe?.();
  }, []);

  const total = assets.length;
  const llcCount = assets.filter((a) => a.type === "LLC").length;
  const ccorpCount = assets.filter((a) => a.type === "C-Corp").length;
  const stateCount = new Set(assets.map((a) => a.state).filter(Boolean)).size;
  const rootEntities = assets
    .filter((a) => !a.ownerId || !assets.find((p) => p.id === a.ownerId))
    .sort((a, b) => a.name.localeCompare(b.name));
  const missingDocs = assets.filter(
    (a) => !a.operatingAgreementDate || !a.articlesOfOrgDate || !a.stateLink
  ).length;

  const today = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const subText = isDark ? "text-gray-400" : "text-gray-500";
  const statCard = isDark ? "bg-white/5 border-white/10" : "bg-black/5 border-gray-200";
  const linkCard = isDark
    ? "bg-white/5 border-white/10 hover:bg-white/10"
    : "bg-black/5 border-gray-200 hover:bg-gray-100";

  const stats = [
    { label: "Entities", value: total },
    { label: "LLCs", value: llcCount },
    { label: "C-Corps", value: ccorpCount },
    { label: "States", value: stateCount },
  ];

  return (
    <div className="space-y-8">
      {/* Greeting */}
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold">Welcome back, Worrell</h1>
        <p className={`${subText} mt-1`}>{today}</p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((s) => (
          <div key={s.label} className={`p-5 border rounded-xl ${statCard}`}>
            <p className={`text-sm ${subText}`}>{s.label}</p>
            <p className="text-3xl font-bold mt-1">{loading ? "—" : s.value}</p>
          </div>
        ))}
      </div>

      {/* Needs attention */}
      {!loading && missingDocs > 0 && (
        <Link
          to="/assets"
          className={`flex items-center gap-3 p-4 border rounded-xl transition-colors ${
            isDark
              ? "bg-yellow-500/10 border-yellow-500/20 hover:bg-yellow-500/15"
              : "bg-yellow-50 border-yellow-200 hover:bg-yellow-100"
          }`}
        >
          <svg
            className={`w-5 h-5 shrink-0 ${isDark ? "text-yellow-400" : "text-yellow-600"}`}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
            />
          </svg>
          <p className="text-sm">
            <span className="font-semibold">{missingDocs}</span>{" "}
            {missingDocs === 1 ? "entity is" : "entities are"} missing documents
            (operating agreement, articles, or state link).
          </p>
        </Link>
      )}

      {/* Quick access */}
      <div>
        <h2 className="text-lg font-semibold mb-3">Quick access</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {QUICK_LINKS.map((q) => (
            <Link
              key={q.to}
              to={q.to}
              className={`p-5 border rounded-xl transition-colors block ${linkCard}`}
            >
              <div className="flex items-center gap-3">
                <span
                  className={`flex items-center justify-center w-10 h-10 rounded-lg shrink-0 ${
                    isDark ? "bg-white/10" : "bg-black/5"
                  }`}
                >
                  <svg
                    className="w-5 h-5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.6}
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d={q.path} />
                  </svg>
                </span>
                <div>
                  <h3 className="font-semibold">{q.title}</h3>
                  <p className={`text-sm ${subText}`}>{q.desc}</p>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* Top-level entities */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">Top-level entities</h2>
          <Link
            to="/assets"
            className={`text-sm ${
              isDark ? "text-blue-400 hover:text-blue-300" : "text-blue-600 hover:text-blue-500"
            }`}
          >
            View all →
          </Link>
        </div>
        {loading ? (
          <p className={subText}>Loading…</p>
        ) : rootEntities.length === 0 ? (
          <p className={subText}>No entities yet.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {rootEntities.map((e) => (
              <Link
                key={e.id}
                to={`/assets/${e.id}`}
                className={`p-4 border rounded-xl transition-colors block ${linkCard}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-medium truncate">{e.name}</h3>
                  <span
                    className={`text-[10px] font-mono px-1.5 py-0.5 rounded shrink-0 ${
                      e.type === "C-Corp"
                        ? isDark
                          ? "bg-purple-500/20 text-purple-300"
                          : "bg-purple-50 text-purple-700"
                        : isDark
                          ? "bg-blue-500/20 text-blue-300"
                          : "bg-blue-50 text-blue-700"
                    }`}
                  >
                    {e.type}
                  </span>
                </div>
                <p className={`text-sm mt-1 ${subText}`}>{e.state || "—"}</p>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
