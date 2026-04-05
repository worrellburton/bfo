import { Link } from "react-router";

export function meta() {
  return [{ title: "BFO - FDJ Hesperia Financials" }];
}

function fmt(n: number) {
  return n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function pctChange(actual: number, budget: number) {
  return ((actual - budget) / budget) * 100;
}

// --- Reusable Components ---

function StatCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
      <div className="text-[9px] text-gray-500 uppercase tracking-wider mb-1">{label}</div>
      <div className="text-xl font-bold tabular-nums" style={color ? { color } : undefined}>{value}</div>
      {sub && <div className="text-[10px] text-gray-500 mt-1">{sub}</div>}
    </div>
  );
}

function PctBadge({ value }: { value: number }) {
  const isPositive = value >= 0;
  return (
    <span className={`inline-flex items-center text-[10px] font-semibold tabular-nums ${isPositive ? "text-emerald-400" : "text-red-400"}`}>
      {isPositive ? "+" : ""}{value.toFixed(1)}%
    </span>
  );
}

// --- Tab Navigation ---

const tabs = [
  { label: "Overview", href: "/tools/fdj-hesperia", active: false },
  { label: "Financials", href: "/tools/fdj-hesperia/financials", active: true },
  { label: "Documents", href: "/tools/fdj-hesperia/documents", active: false },
  { label: "Advisory", href: "/tools/fdj-hesperia/advisory", active: false },
  { label: "Tax", href: "/tools/fdj-hesperia/tax", active: false },
];

// --- Promissory Notes Data ---

const promissoryNotes = [
  { date: "Dec 21, 2016", amount: 1000000, rate: 3.0, monthlyAccrual: 3500, annualPayment: 42000, due: "On demand" },
  { date: "Apr 21, 2017", amount: 1000000, rate: 3.0, monthlyAccrual: 3500, annualPayment: 42000, due: "On demand" },
  { date: "Jul 18, 2018", amount: 1000000, rate: 3.0, monthlyAccrual: 3500, annualPayment: 42000, due: "On demand" },
  { date: "Oct 5, 2018", amount: 1400000, rate: 3.0, monthlyAccrual: 3500, annualPayment: 42000, due: "On demand" },
];

// --- Property Operating Data ---

const elDorado = {
  name: "El Dorado Apartments",
  type: "Multifamily",
  purchase: 5475000,
  loan: 2500000,
  rate: 4.86,
  annualPayment: 121500,
  maturity: "Nov 2025",
  ltv2020: 32.97,
  actualValue: 7582259,
  equity: 5082259,
  masterLease: { monthly: 13167, annual: 158000 },
  budget2017: { grossIncome: 788409, expenses: 496141, noi: 292268, mortgage: 121500, cashFlow: 170768 },
  actual2020: { grossIncome: 895137, expenses: 516024, noi: 379113, mortgage: 121500, cashFlow: 257613 },
};

const comfortSuites = {
  name: "Comfort Suites",
  type: "Hospitality",
  purchase: 7273000,
  loan: 3350000,
  rate: 5.50,
  annualPayment: 184250,
  maturity: "May 2027",
  ltv2020: 50.97,
  actualValue: 6572145,
  equity: 3222145,
  masterLease: { monthly: 20167, annual: 242000 },
  budget2017: { grossIncome: 2051139, expenses: 1509754, noi: 541385, mortgage: 184250, cashFlow: 357135 },
  actual2020: { grossIncome: 1607757, expenses: 1147707, noi: 460050, mortgage: 184250, cashFlow: 275800 },
};

// --- Mini Bar ---

function MiniBar({ value, max, color = "emerald" }: { value: number; max: number; color?: string }) {
  const pct = Math.min((value / max) * 100, 100);
  const colorMap: Record<string, string> = {
    emerald: "from-emerald-500 to-emerald-600",
    indigo: "from-indigo-500 to-indigo-600",
    amber: "from-amber-500 to-amber-600",
    red: "from-red-500 to-red-600",
  };
  return (
    <div className="h-1.5 bg-white/5 rounded-full overflow-hidden mt-1">
      <div className={`h-full rounded-full bg-gradient-to-r ${colorMap[color]}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

// --- LTV Gauge ---

function LTVGauge({ ltv, label }: { ltv: number; label: string }) {
  const color = ltv < 40 ? "emerald" : ltv < 60 ? "amber" : "red";
  const colorClasses: Record<string, string> = {
    emerald: "from-emerald-500 to-emerald-600",
    amber: "from-amber-500 to-amber-600",
    red: "from-red-500 to-red-600",
  };
  const textColor: Record<string, string> = {
    emerald: "text-emerald-400",
    amber: "text-amber-400",
    red: "text-red-400",
  };
  return (
    <div>
      <div className="flex justify-between text-[10px] mb-1">
        <span className="text-gray-500">{label}</span>
        <span className={`tabular-nums font-semibold ${textColor[color]}`}>{ltv.toFixed(2)}%</span>
      </div>
      <div className="h-3 bg-white/5 rounded-full overflow-hidden">
        <div className={`h-full rounded-full bg-gradient-to-r ${colorClasses[color]} transition-all duration-700`} style={{ width: `${ltv}%` }} />
      </div>
    </div>
  );
}

// --- Waterfall Chart ---

function WaterfallChart() {
  const combined2020 = {
    grossIncome: elDorado.actual2020.grossIncome + comfortSuites.actual2020.grossIncome,
    expenses: elDorado.actual2020.expenses + comfortSuites.actual2020.expenses,
    noi: elDorado.actual2020.noi + comfortSuites.actual2020.noi,
    debtService: elDorado.annualPayment + comfortSuites.annualPayment,
    cashFlow: elDorado.actual2020.cashFlow + comfortSuites.actual2020.cashFlow,
  };

  const max = combined2020.grossIncome;
  const items = [
    { label: "Gross Income", value: combined2020.grossIncome, running: combined2020.grossIncome, type: "positive" as const },
    { label: "Expenses", value: combined2020.expenses, running: combined2020.grossIncome - combined2020.expenses, type: "negative" as const },
    { label: "NOI", value: combined2020.noi, running: combined2020.noi, type: "subtotal" as const },
    { label: "Debt Service", value: combined2020.debtService, running: combined2020.noi - combined2020.debtService, type: "negative" as const },
    { label: "Cash Flow", value: combined2020.cashFlow, running: combined2020.cashFlow, type: "result" as const },
  ];

  const barHeight = 200;

  return (
    <div className="flex items-end gap-3 justify-between px-2" style={{ height: barHeight + 40 }}>
      {items.map((item, i) => {
        const barPct = (item.value / max) * 100;
        const bottomPct = item.type === "negative" ? ((item.running) / max) * 100 : 0;
        const colors: Record<string, string> = {
          positive: "bg-gradient-to-t from-emerald-600 to-emerald-500",
          negative: "bg-gradient-to-t from-red-600 to-red-500",
          subtotal: "bg-gradient-to-t from-indigo-600 to-indigo-500",
          result: "bg-gradient-to-t from-emerald-600 to-emerald-400",
        };

        return (
          <div key={i} className="flex-1 flex flex-col items-center gap-1">
            <div className="text-[10px] tabular-nums font-semibold text-gray-300">${fmt(item.value)}</div>
            <div className="w-full relative" style={{ height: barHeight }}>
              <div
                className={`absolute bottom-0 left-1 right-1 rounded-t ${colors[item.type]} transition-all duration-700`}
                style={{
                  height: `${barPct}%`,
                  bottom: `${bottomPct}%`,
                }}
              />
            </div>
            <div className="text-[9px] text-gray-500 text-center leading-tight">{item.label}</div>
          </div>
        );
      })}
    </div>
  );
}

// --- Donut Chart ---

function DonutChart() {
  const cashReceived = 1577042;
  const equity = 8304404;
  const taxSavings = 3200000;
  const total = cashReceived + equity + taxSavings;

  const segments = [
    { label: "Equity", value: equity, color: "#10b981", pct: (equity / total) * 100 },
    { label: "Tax Savings", value: taxSavings, color: "#6366f1", pct: (taxSavings / total) * 100 },
    { label: "Cash Received", value: cashReceived, color: "#f59e0b", pct: (cashReceived / total) * 100 },
  ];

  // Build SVG donut
  const radius = 60;
  const cx = 80;
  const cy = 80;
  const strokeWidth = 20;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <div className="flex flex-col sm:flex-row items-center gap-6">
      <svg width="160" height="160" viewBox="0 0 160 160">
        <circle cx={cx} cy={cy} r={radius} fill="none" stroke="rgba(255,255,255,0.03)" strokeWidth={strokeWidth} />
        {segments.map((seg, i) => {
          const dashLength = (seg.pct / 100) * circumference;
          const dashArray = `${dashLength} ${circumference - dashLength}`;
          const rotation = (offset / 100) * 360 - 90;
          offset += seg.pct;
          return (
            <circle
              key={i}
              cx={cx}
              cy={cy}
              r={radius}
              fill="none"
              stroke={seg.color}
              strokeWidth={strokeWidth}
              strokeDasharray={dashArray}
              strokeLinecap="butt"
              transform={`rotate(${rotation} ${cx} ${cy})`}
              className="transition-all duration-700"
            />
          );
        })}
        <text x={cx} y={cy - 6} textAnchor="middle" fill="white" fontSize="16" fontWeight="bold">503%</text>
        <text x={cx} y={cy + 10} textAnchor="middle" fill="#6b7280" fontSize="9">TOTAL ROI</text>
      </svg>
      <div className="space-y-3 flex-1">
        {segments.map((seg, i) => (
          <div key={i} className="flex items-center gap-3">
            <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: seg.color }} />
            <div className="flex-1 min-w-0">
              <div className="text-[10px] text-gray-500">{seg.label}</div>
              <div className="text-sm font-bold tabular-nums text-gray-200">${fmt(seg.value)}</div>
            </div>
            <div className="text-[10px] text-gray-400 tabular-nums">{seg.pct.toFixed(1)}%</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// --- Operating Performance Comparison Row ---

function OpRow({ label, budget, actual, maxVal, budgetColor = "indigo", actualColor = "emerald" }: {
  label: string;
  budget: number;
  actual: number;
  maxVal: number;
  budgetColor?: string;
  actualColor?: string;
}) {
  const change = pctChange(actual, budget);
  return (
    <div className="py-2.5 border-b border-white/5 last:border-b-0">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-gray-400">{label}</span>
        <PctBadge value={change} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="text-[10px] text-gray-500 mb-0.5">2017 Budget</div>
          <div className="text-xs font-semibold tabular-nums text-gray-300">${fmt(budget)}</div>
          <MiniBar value={budget} max={maxVal} color={budgetColor} />
        </div>
        <div>
          <div className="text-[10px] text-gray-500 mb-0.5">2020 Actual</div>
          <div className="text-xs font-semibold tabular-nums text-gray-200">${fmt(actual)}</div>
          <MiniBar value={actual} max={maxVal} color={actualColor} />
        </div>
      </div>
    </div>
  );
}

// --- Main Component ---

export default function FDJHesperiaFinancials() {
  return (
    <div className="max-w-6xl">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-xs text-gray-500 mb-4">
        <Link to="/tools" className="hover:text-white transition-colors">Tools</Link>
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        <Link to="/tools/fdj-hesperia" className="hover:text-white transition-colors">FDJ Hesperia</Link>
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        <span className="text-gray-300">Financials</span>
      </div>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold mb-1">FDJ Hesperia Financials</h1>
          <p className="text-gray-500 text-sm">Investment performance, debt structure, and returns analysis</p>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-1 border-b border-white/10 mb-8">
        {tabs.map((tab) => (
          <Link
            key={tab.label}
            to={tab.href}
            className={`px-4 py-2 text-sm font-medium transition-colors relative ${
              tab.active
                ? "text-white"
                : "text-gray-500 hover:text-gray-300"
            }`}
          >
            {tab.label}
            {tab.active && (
              <div className="absolute bottom-0 left-0 right-0 h-px bg-emerald-500" />
            )}
          </Link>
        ))}
      </div>

      {/* Section 1: Investment Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
        <StatCard label="Original Investment" value="$6,998,000" sub="$2,975,000 + $4,023,000 down payments" color="#6366f1" />
        <StatCard label="Loans Received Back" value="$4,400,000" sub="4 promissory notes from BWL" color="#f59e0b" />
        <StatCard label="Net Cash at Risk" value="$2,600,000" sub="After $4.4M loan-back" color="#10b981" />
        <StatCard label="Annual Return Rate" value="8.0%" sub="$207,996/yr on net investment" color="#10b981" />
      </div>

      {/* Section 2: Promissory Notes Table */}
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5 mb-8">
        <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">BWL Promissory Notes</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10">
                <th className="text-left text-[9px] text-gray-500 uppercase tracking-wider pb-3 pr-4">Date</th>
                <th className="text-right text-[9px] text-gray-500 uppercase tracking-wider pb-3 pr-4">Principal</th>
                <th className="text-right text-[9px] text-gray-500 uppercase tracking-wider pb-3 pr-4">Rate</th>
                <th className="text-right text-[9px] text-gray-500 uppercase tracking-wider pb-3 pr-4">Monthly Accrual</th>
                <th className="text-right text-[9px] text-gray-500 uppercase tracking-wider pb-3 pr-4">Annual Payment</th>
                <th className="text-right text-[9px] text-gray-500 uppercase tracking-wider pb-3">Terms</th>
              </tr>
            </thead>
            <tbody>
              {promissoryNotes.map((note, i) => (
                <tr key={i} className="border-b border-white/5">
                  <td className="py-3 pr-4 text-gray-300 tabular-nums">{note.date}</td>
                  <td className="py-3 pr-4 text-right tabular-nums text-gray-200 font-semibold">${fmt(note.amount)}</td>
                  <td className="py-3 pr-4 text-right tabular-nums text-gray-400">{note.rate.toFixed(1)}%</td>
                  <td className="py-3 pr-4 text-right tabular-nums text-amber-400">${fmt(note.monthlyAccrual)}</td>
                  <td className="py-3 pr-4 text-right tabular-nums text-gray-300">${fmt(note.annualPayment)}</td>
                  <td className="py-3 text-right text-gray-500 text-xs">{note.due}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-white/10">
                <td className="py-3 pr-4 text-gray-300 font-semibold">Total</td>
                <td className="py-3 pr-4 text-right tabular-nums text-white font-bold">${fmt(4400000)}</td>
                <td className="py-3 pr-4 text-right tabular-nums text-gray-400">3.0%</td>
                <td className="py-3 pr-4 text-right tabular-nums text-amber-400 font-semibold">${fmt(14000)}</td>
                <td className="py-3 pr-4 text-right tabular-nums text-white font-bold">${fmt(168000)}</td>
                <td className="py-3"></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Section 3: Debt Structure */}
      <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Debt Structure</h2>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-8">
        {[elDorado, comfortSuites].map((prop) => (
          <div key={prop.name} className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
            <div className="flex items-start justify-between mb-4">
              <div>
                <div className="text-[9px] text-gray-500 uppercase tracking-wider">{prop.type}</div>
                <div className="text-base font-bold text-gray-100">{prop.name}</div>
              </div>
              <div className="text-[10px] text-gray-400 bg-white/5 px-2 py-0.5 rounded">Interest Only</div>
            </div>

            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <div className="text-[9px] text-gray-500 uppercase tracking-wider mb-0.5">Principal</div>
                <div className="text-sm font-semibold tabular-nums text-amber-400">${fmt(prop.loan)}</div>
              </div>
              <div>
                <div className="text-[9px] text-gray-500 uppercase tracking-wider mb-0.5">Interest Rate</div>
                <div className="text-sm font-semibold tabular-nums text-gray-200">{prop.rate.toFixed(2)}%</div>
              </div>
              <div>
                <div className="text-[9px] text-gray-500 uppercase tracking-wider mb-0.5">Annual Payment</div>
                <div className="text-sm font-semibold tabular-nums text-gray-200">${fmt(prop.annualPayment)}</div>
              </div>
              <div>
                <div className="text-[9px] text-gray-500 uppercase tracking-wider mb-0.5">Maturity</div>
                <div className="text-sm font-semibold text-gray-200">{prop.maturity}</div>
              </div>
              <div>
                <div className="text-[9px] text-gray-500 uppercase tracking-wider mb-0.5">Actual Value (2020)</div>
                <div className="text-sm font-semibold tabular-nums text-gray-200">${fmt(prop.actualValue)}</div>
              </div>
              <div>
                <div className="text-[9px] text-gray-500 uppercase tracking-wider mb-0.5">Equity</div>
                <div className="text-sm font-semibold tabular-nums text-emerald-400">${fmt(prop.equity)}</div>
              </div>
            </div>

            <LTVGauge ltv={prop.ltv2020} label="Loan-to-Value Ratio" />
          </div>
        ))}
      </div>

      {/* Section 4: Property Operating Performance */}
      <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Property Operating Performance</h2>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-8">
        {[elDorado, comfortSuites].map((prop) => {
          const maxVal = Math.max(prop.budget2017.grossIncome, prop.actual2020.grossIncome);
          return (
            <div key={prop.name} className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
              <div className="mb-4">
                <div className="text-[9px] text-gray-500 uppercase tracking-wider">{prop.type}</div>
                <div className="text-base font-bold text-gray-100">{prop.name}</div>
              </div>
              <OpRow label="Gross Income" budget={prop.budget2017.grossIncome} actual={prop.actual2020.grossIncome} maxVal={maxVal} />
              <OpRow label="Total Expenses" budget={prop.budget2017.expenses} actual={prop.actual2020.expenses} maxVal={maxVal} budgetColor="red" actualColor="red" />
              <OpRow label="Net Operating Income" budget={prop.budget2017.noi} actual={prop.actual2020.noi} maxVal={maxVal} />
              <OpRow label="Mortgage Payment" budget={prop.budget2017.mortgage} actual={prop.actual2020.mortgage} maxVal={maxVal} budgetColor="amber" actualColor="amber" />
              <OpRow label="Cash Flow" budget={prop.budget2017.cashFlow} actual={prop.actual2020.cashFlow} maxVal={maxVal} />
            </div>
          );
        })}
      </div>

      {/* Section 5: Cash Flow Waterfall */}
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5 mb-8">
        <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-2">Combined Cash Flow Waterfall</h3>
        <div className="text-[10px] text-gray-500 mb-4">2020 actuals, both properties combined</div>
        <WaterfallChart />
      </div>

      {/* Section 6: Investment Returns Dashboard */}
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5 mb-8">
        <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-5">Investment Returns Dashboard</h3>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Left: Return breakdown */}
          <div>
            <div className="space-y-4 mb-6">
              <div className="flex items-center justify-between py-2 border-b border-white/5">
                <div>
                  <div className="text-xs text-gray-400">Cash Invested</div>
                  <div className="text-[10px] text-gray-500">Net after $4.4M loan-back</div>
                </div>
                <div className="text-sm font-bold tabular-nums text-gray-200">$2,600,000</div>
              </div>

              <div className="flex items-center justify-between py-2 border-b border-white/5">
                <div>
                  <div className="text-xs text-gray-400">Cash Received</div>
                  <div className="text-[10px] text-gray-500">Through April 2022</div>
                </div>
                <div className="text-sm font-bold tabular-nums text-emerald-400">$1,577,042</div>
              </div>

              <div className="flex items-center justify-between py-2 border-b border-white/5">
                <div>
                  <div className="text-xs text-gray-400">Total Equity</div>
                  <div className="text-[10px] text-gray-500">Combined property equity (2020)</div>
                </div>
                <div className="text-sm font-bold tabular-nums text-emerald-400">$8,304,404</div>
              </div>

              <div className="flex items-center justify-between py-2 border-b border-white/5">
                <div>
                  <div className="text-xs text-gray-400">Tax Savings</div>
                  <div className="text-[10px] text-gray-500">1031 exchange benefit</div>
                </div>
                <div className="text-sm font-bold tabular-nums text-emerald-400">$3,200,000</div>
              </div>

              <div className="flex items-center justify-between py-2 border-b border-white/5">
                <div>
                  <div className="text-xs text-gray-400">Marriott Ownership</div>
                  <div className="text-[10px] text-gray-500">30% of TownePlace Suites</div>
                </div>
                <div className="text-sm font-bold tabular-nums text-indigo-400">+ Upside</div>
              </div>
            </div>

            {/* ROI Calculation */}
            <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-4">
              <div className="text-[9px] text-gray-500 uppercase tracking-wider mb-2">Total Return Calculation</div>
              <div className="text-xs text-gray-400 mb-1 font-mono tabular-nums">
                ($1,577,042 + $8,304,404 + $3,200,000) / $2,600,000
              </div>
              <div className="flex items-baseline gap-2">
                <div className="text-2xl font-bold text-emerald-400">503%</div>
                <div className="text-xs text-gray-500">total return on net investment</div>
              </div>
              <div className="mt-2 text-[10px] text-gray-500">
                Cash-on-cash: $207,996 / $2,600,000 = <span className="text-emerald-400 font-semibold">8.0%</span> annually
              </div>
            </div>
          </div>

          {/* Right: Donut chart */}
          <div className="flex flex-col justify-center">
            <div className="text-[9px] text-gray-500 uppercase tracking-wider mb-4">Returns Composition</div>
            <DonutChart />
          </div>
        </div>
      </div>

      {/* Section 7: Projected vs Actual */}
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5 mb-8">
        <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-2">Projected vs Actual</h3>
        <div className="text-[10px] text-gray-500 mb-4">2017 budget projections compared to 2020 actual performance</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10">
                <th className="text-left text-[9px] text-gray-500 uppercase tracking-wider pb-3 pr-4">Metric</th>
                <th className="text-right text-[9px] text-gray-500 uppercase tracking-wider pb-3 pr-4" colSpan={1}>
                  <span className="inline-block px-1.5 py-0.5 rounded bg-indigo-500/15 text-indigo-400">EDA Budget</span>
                </th>
                <th className="text-right text-[9px] text-gray-500 uppercase tracking-wider pb-3 pr-4" colSpan={1}>
                  <span className="inline-block px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400">EDA Actual</span>
                </th>
                <th className="text-right text-[9px] text-gray-500 uppercase tracking-wider pb-3 pr-4">Var</th>
                <th className="text-right text-[9px] text-gray-500 uppercase tracking-wider pb-3 pr-4" colSpan={1}>
                  <span className="inline-block px-1.5 py-0.5 rounded bg-indigo-500/15 text-indigo-400">CS Budget</span>
                </th>
                <th className="text-right text-[9px] text-gray-500 uppercase tracking-wider pb-3 pr-4" colSpan={1}>
                  <span className="inline-block px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400">CS Actual</span>
                </th>
                <th className="text-right text-[9px] text-gray-500 uppercase tracking-wider pb-3">Var</th>
              </tr>
            </thead>
            <tbody>
              {[
                { label: "Gross Income", edaBudget: elDorado.budget2017.grossIncome, edaActual: elDorado.actual2020.grossIncome, csBudget: comfortSuites.budget2017.grossIncome, csActual: comfortSuites.actual2020.grossIncome },
                { label: "Expenses", edaBudget: elDorado.budget2017.expenses, edaActual: elDorado.actual2020.expenses, csBudget: comfortSuites.budget2017.expenses, csActual: comfortSuites.actual2020.expenses },
                { label: "NOI", edaBudget: elDorado.budget2017.noi, edaActual: elDorado.actual2020.noi, csBudget: comfortSuites.budget2017.noi, csActual: comfortSuites.actual2020.noi },
                { label: "Mortgage", edaBudget: elDorado.budget2017.mortgage, edaActual: elDorado.actual2020.mortgage, csBudget: comfortSuites.budget2017.mortgage, csActual: comfortSuites.actual2020.mortgage },
                { label: "Cash Flow", edaBudget: elDorado.budget2017.cashFlow, edaActual: elDorado.actual2020.cashFlow, csBudget: comfortSuites.budget2017.cashFlow, csActual: comfortSuites.actual2020.cashFlow },
              ].map((row, i) => {
                const edaChange = pctChange(row.edaActual, row.edaBudget);
                const csChange = pctChange(row.csActual, row.csBudget);
                const isBold = row.label === "NOI" || row.label === "Cash Flow";
                const isExpense = row.label === "Expenses";
                return (
                  <tr key={i} className={`border-b border-white/5 ${isBold ? "bg-white/[0.02]" : ""}`}>
                    <td className={`py-2.5 pr-4 text-gray-300 ${isBold ? "font-semibold" : ""}`}>{row.label}</td>
                    <td className="py-2.5 pr-4 text-right tabular-nums text-gray-400">${fmt(row.edaBudget)}</td>
                    <td className="py-2.5 pr-4 text-right tabular-nums text-gray-200 font-semibold">${fmt(row.edaActual)}</td>
                    <td className="py-2.5 pr-4 text-right">
                      <PctBadge value={isExpense ? -edaChange : edaChange} />
                    </td>
                    <td className="py-2.5 pr-4 text-right tabular-nums text-gray-400">${fmt(row.csBudget)}</td>
                    <td className="py-2.5 pr-4 text-right tabular-nums text-gray-200 font-semibold">${fmt(row.csActual)}</td>
                    <td className="py-2.5 text-right">
                      <PctBadge value={isExpense ? -csChange : csChange} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-white/10">
                <td className="py-3 pr-4 text-gray-300 font-bold">Combined CF</td>
                <td className="py-3 pr-4 text-right tabular-nums text-gray-400 font-semibold" colSpan={2}>
                  ${fmt(elDorado.budget2017.cashFlow + comfortSuites.budget2017.cashFlow)}/yr
                </td>
                <td className="py-3 pr-4"></td>
                <td className="py-3 pr-4 text-right tabular-nums text-emerald-400 font-bold" colSpan={2}>
                  ${fmt(elDorado.actual2020.cashFlow + comfortSuites.actual2020.cashFlow)}/yr
                </td>
                <td className="py-3 text-right">
                  <PctBadge value={pctChange(
                    elDorado.actual2020.cashFlow + comfortSuites.actual2020.cashFlow,
                    elDorado.budget2017.cashFlow + comfortSuites.budget2017.cashFlow
                  )} />
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}
