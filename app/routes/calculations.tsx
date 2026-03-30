import { Link } from "react-router";

export function meta() {
  return [{ title: "BFO - Tools" }];
}

const calculators = [
  {
    to: "/tools/developer-payment",
    title: "Developer Payment Calculator",
    description: "Breakdown of Sam & Mercy's compensation — weekly, monthly, daily insights.",
    icon: (
      <svg viewBox="0 0 24 24" className="w-8 h-8" fill="none" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z" />
      </svg>
    ),
    color: "#6366f1",
  },
  {
    to: "/tools/property-analysis",
    title: "Property Analysis: 1344 Tydings Rd",
    description: "Full analysis of 1344 Tydings Rd, Annapolis — value, mortgage, appreciation & more.",
    icon: (
      <svg viewBox="0 0 24 24" className="w-8 h-8" fill="none" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 21v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21m0 0h4.5V3.545M12.75 21h7.5V10.75M2.25 21h1.5m18 0h-18M2.25 9l4.5-1.636M18.75 3l-1.5.545m0 6.205l3 1m1.5.5l-1.5-.5M6.75 7.364V3h-3v3.364M3.75 21h16.5M2.25 9C2.25 9 6.75 7.364 6.75 7.364" />
      </svg>
    ),
    color: "#10b981",
  },
  {
    to: "/tools/fdj-hesperia",
    title: "FDJ Hesperia Mission Control",
    description: "Burton Family investment dashboard — deal overview, financials, documents & advisory.",
    icon: (
      <svg viewBox="0 0 24 24" className="w-8 h-8" fill="none" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
      </svg>
    ),
    color: "#f59e0b",
  },
];

export default function Calculations() {
  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Tools</h1>
      <p className="text-gray-500 text-sm mb-8">Financial tools and calculators</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {calculators.map((calc) => (
          <Link
            key={calc.to}
            to={calc.to}
            className="group relative rounded-xl border border-white/10 hover:border-white/20 bg-white/[0.02] hover:bg-white/[0.04] p-6 transition-all duration-200"
          >
            <div
              className="w-12 h-12 rounded-lg flex items-center justify-center mb-4 transition-transform group-hover:scale-110"
              style={{ background: `${calc.color}20`, color: calc.color }}
            >
              {calc.icon}
            </div>
            <h3 className="font-semibold text-sm mb-1">{calc.title}</h3>
            <p className="text-gray-500 text-xs leading-relaxed">{calc.description}</p>
            <div className="absolute top-5 right-5 text-gray-600 group-hover:text-white transition-colors">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
