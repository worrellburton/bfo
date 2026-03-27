import { useState } from "react";
import { Link } from "react-router";

export function meta() {
  return [{ title: "BFO - Developer Payment Calculator" }];
}

interface DevConfig {
  name: string;
  color: string;
  annual: number;
  type: "fixed" | "percentage";
  percentOf?: string; // name of the person they're a percentage of
  percentRate?: number;
}

function fmt(n: number) {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtShort(n: number) {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return n.toFixed(0);
}

// Animated number that counts up
function AnimNum({ value, prefix = "$" }: { value: number; prefix?: string }) {
  return (
    <span className="tabular-nums">
      {prefix}{fmt(value)}
    </span>
  );
}

// Mini donut chart SVG
function DonutChart({ slices, size = 120 }: { slices: { value: number; color: string; label: string }[]; size?: number }) {
  const total = slices.reduce((s, sl) => s + sl.value, 0);
  const r = 40;
  const cx = 50;
  const cy = 50;
  let cumAngle = -90;

  return (
    <svg viewBox="0 0 100 100" width={size} height={size}>
      {slices.map((sl, i) => {
        const angle = (sl.value / total) * 360;
        const startAngle = cumAngle;
        const endAngle = cumAngle + angle;
        cumAngle = endAngle;

        const startRad = (startAngle * Math.PI) / 180;
        const endRad = (endAngle * Math.PI) / 180;
        const x1 = cx + r * Math.cos(startRad);
        const y1 = cy + r * Math.sin(startRad);
        const x2 = cx + r * Math.cos(endRad);
        const y2 = cy + r * Math.sin(endRad);
        const largeArc = angle > 180 ? 1 : 0;

        return (
          <path
            key={i}
            d={`M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} Z`}
            fill={sl.color}
            opacity={0.85}
            className="transition-all duration-500"
          >
            <title>{sl.label}: ${fmt(sl.value)}</title>
          </path>
        );
      })}
      <circle cx={cx} cy={cy} r={22} fill="#0a0a0a" />
      <text x={cx} y={cy - 3} textAnchor="middle" fill="white" fontSize="7" fontWeight="bold">
        ${fmtShort(total)}
      </text>
      <text x={cx} y={cy + 6} textAnchor="middle" fill="#888" fontSize="4.5">
        /year
      </text>
    </svg>
  );
}

// Horizontal bar comparison
function CompBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div className="flex items-center gap-3">
      <span className="text-[10px] text-gray-400 w-16 text-right shrink-0">{label}</span>
      <div className="flex-1 h-5 bg-white/5 rounded-full overflow-hidden relative">
        <div
          className="h-full rounded-full transition-all duration-700 ease-out"
          style={{ width: `${pct}%`, background: color }}
        />
        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[9px] text-white/70 font-medium">
          ${fmt(value)}
        </span>
      </div>
    </div>
  );
}

// Sparkline-style bar chart for monthly
function MonthlyBars({ monthly, color, name }: { monthly: number; color: string; name: string }) {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <div className="w-2 h-2 rounded-full" style={{ background: color }} />
        <span className="text-[10px] font-medium text-gray-300">{name}</span>
        <span className="text-[10px] text-gray-500">${fmt(monthly)}/mo</span>
      </div>
      <div className="flex items-end gap-[3px] h-14">
        {months.map((m, i) => (
          <div key={m} className="flex-1 flex flex-col items-center gap-0.5">
            <div
              className="w-full rounded-t transition-all duration-500"
              style={{
                height: `${32 + Math.sin(i * 0.5) * 4}px`,
                background: `linear-gradient(180deg, ${color} 0%, ${color}60 100%)`,
                animationDelay: `${i * 60}ms`,
              }}
            />
            <span className="text-[7px] text-gray-600">{m}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Timeline dots for pay periods
function PayTimeline({ weekly, biweekly, label, color }: { weekly: number; biweekly: number; label: string; color: string }) {
  return (
    <div className="space-y-2">
      <div className="text-[10px] font-medium text-gray-300 flex items-center gap-2">
        <div className="w-2 h-2 rounded-full" style={{ background: color }} />
        {label}
      </div>
      <div className="flex items-center gap-1">
        {Array.from({ length: 52 }).map((_, i) => (
          <div
            key={i}
            className="h-3 rounded-sm transition-all duration-300"
            style={{
              width: "calc((100% - 51 * 4px) / 52)",
              minWidth: "2px",
              background: i % 2 === 0 ? color : `${color}40`,
              opacity: 0.4 + (i / 52) * 0.6,
            }}
            title={`Week ${i + 1}: $${fmt(weekly)}`}
          />
        ))}
      </div>
      <div className="flex justify-between text-[8px] text-gray-600">
        <span>Week 1 — ${fmt(weekly)}</span>
        <span>Bi-weekly — ${fmt(biweekly)}</span>
        <span>Week 52</span>
      </div>
    </div>
  );
}

export default function DevPaymentCalculator() {
  const [samAnnual, setSamAnnual] = useState(30000);
  const [mercyPercent, setMercyPercent] = useState(15);

  const mercyAnnual = samAnnual * (mercyPercent / 100);
  const totalAnnual = samAnnual + mercyAnnual;

  const devs: DevConfig[] = [
    { name: "Sam", color: "#6366f1", annual: samAnnual, type: "fixed" },
    { name: "Mercy", color: "#f59e0b", annual: mercyAnnual, type: "percentage", percentOf: "Sam", percentRate: mercyPercent },
  ];

  const breakdowns = devs.map((d) => ({
    ...d,
    monthly: d.annual / 12,
    biweekly: d.annual / 26,
    weekly: d.annual / 52,
    daily: d.annual / 365,
    hourly: d.annual / (52 * 40),
    percentOfTotal: (d.annual / totalAnnual) * 100,
  }));

  const totalBreakdown = {
    annual: totalAnnual,
    monthly: totalAnnual / 12,
    biweekly: totalAnnual / 26,
    weekly: totalAnnual / 52,
    daily: totalAnnual / 365,
    hourly: totalAnnual / (52 * 40),
  };

  return (
    <div className="max-w-5xl">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-xs text-gray-500 mb-4">
        <Link to="/calculations" className="hover:text-white transition-colors">Calculations</Link>
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        <span className="text-gray-300">Developer Payment Calculator</span>
      </div>

      <h1 className="text-2xl font-bold mb-1">Developer Payment Calculator</h1>
      <p className="text-gray-500 text-sm mb-8">Compensation breakdown for Sam &amp; Mercy</p>

      {/* Controls */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
        {/* Sam's salary control */}
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center text-sm font-bold" style={{ background: "#6366f120", color: "#6366f1" }}>S</div>
            <div>
              <div className="text-sm font-semibold">Sam</div>
              <div className="text-[10px] text-gray-500">Fixed Annual Salary</div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-2xl font-bold text-white tabular-nums">${samAnnual.toLocaleString()}</span>
            <span className="text-xs text-gray-500">/year</span>
          </div>
          <input
            type="range"
            min={10000}
            max={100000}
            step={1000}
            value={samAnnual}
            onChange={(e) => setSamAnnual(Number(e.target.value))}
            className="w-full mt-3 accent-[#6366f1]"
          />
          <div className="flex justify-between text-[9px] text-gray-600 mt-1">
            <span>$10k</span>
            <span>$100k</span>
          </div>
        </div>

        {/* Mercy's percentage control */}
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center text-sm font-bold" style={{ background: "#f59e0b20", color: "#f59e0b" }}>M</div>
            <div>
              <div className="text-sm font-semibold">Mercy</div>
              <div className="text-[10px] text-gray-500">{mercyPercent}% of Sam's salary</div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-2xl font-bold text-white tabular-nums">${mercyAnnual.toLocaleString("en-US", { maximumFractionDigits: 0 })}</span>
            <span className="text-xs text-gray-500">/year</span>
          </div>
          <input
            type="range"
            min={1}
            max={100}
            step={1}
            value={mercyPercent}
            onChange={(e) => setMercyPercent(Number(e.target.value))}
            className="w-full mt-3 accent-[#f59e0b]"
          />
          <div className="flex justify-between text-[9px] text-gray-600 mt-1">
            <span>1%</span>
            <span>100%</span>
          </div>
        </div>
      </div>

      {/* Summary cards row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
        {[
          { label: "Total Annual", value: totalBreakdown.annual, icon: "M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" },
          { label: "Monthly", value: totalBreakdown.monthly, icon: "M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" },
          { label: "Weekly", value: totalBreakdown.weekly, icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" },
          { label: "Daily", value: totalBreakdown.daily, icon: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" },
        ].map((card) => (
          <div key={card.label} className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
            <div className="flex items-center gap-2 mb-2">
              <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={card.icon} />
              </svg>
              <span className="text-[10px] text-gray-500 uppercase tracking-wider">{card.label}</span>
            </div>
            <div className="text-lg font-bold tabular-nums">
              <AnimNum value={card.value} />
            </div>
          </div>
        ))}
      </div>

      {/* Main insights grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-8">
        {/* Donut chart */}
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5 flex flex-col items-center">
          <h3 className="text-xs font-semibold text-gray-400 mb-4 self-start">Annual Split</h3>
          <DonutChart
            slices={breakdowns.map((b) => ({
              value: b.annual,
              color: b.color,
              label: b.name,
            }))}
            size={160}
          />
          <div className="flex gap-4 mt-4">
            {breakdowns.map((b) => (
              <div key={b.name} className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-sm" style={{ background: b.color }} />
                <span className="text-[10px] text-gray-400">{b.name}</span>
                <span className="text-[10px] font-medium text-gray-300">{b.percentOfTotal.toFixed(1)}%</span>
              </div>
            ))}
          </div>
        </div>

        {/* Detailed breakdown table */}
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5 lg:col-span-2">
          <h3 className="text-xs font-semibold text-gray-400 mb-4">Pay Period Breakdown</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-gray-500 text-[10px] uppercase tracking-wider">
                  <th className="text-left py-2 pr-4">Period</th>
                  {breakdowns.map((b) => (
                    <th key={b.name} className="text-right py-2 px-2" style={{ color: b.color }}>{b.name}</th>
                  ))}
                  <th className="text-right py-2 pl-2">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {[
                  { label: "Hourly (40h/wk)", key: "hourly" as const },
                  { label: "Daily", key: "daily" as const },
                  { label: "Weekly", key: "weekly" as const },
                  { label: "Bi-weekly", key: "biweekly" as const },
                  { label: "Monthly", key: "monthly" as const },
                  { label: "Annual", key: "annual" as const },
                ].map((row) => (
                  <tr key={row.key} className="hover:bg-white/[0.02] transition-colors">
                    <td className="py-2.5 pr-4 text-gray-400">{row.label}</td>
                    {breakdowns.map((b) => (
                      <td key={b.name} className="py-2.5 px-2 text-right font-medium tabular-nums text-gray-200">
                        ${fmt(b[row.key])}
                      </td>
                    ))}
                    <td className="py-2.5 pl-2 text-right font-bold tabular-nums text-white">
                      ${fmt(totalBreakdown[row.key])}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Bar comparison */}
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5 mb-8">
        <h3 className="text-xs font-semibold text-gray-400 mb-4">Weekly Comparison</h3>
        <div className="space-y-3">
          {breakdowns.map((b) => (
            <CompBar
              key={b.name}
              label={b.name}
              value={b.weekly}
              max={Math.max(...breakdowns.map((x) => x.weekly)) * 1.15}
              color={b.color}
            />
          ))}
          <div className="border-t border-white/5 pt-3">
            <CompBar
              label="Combined"
              value={totalBreakdown.weekly}
              max={totalBreakdown.weekly * 1.15}
              color="#10b981"
            />
          </div>
        </div>
      </div>

      {/* Monthly visualization */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
        {breakdowns.map((b) => (
          <div key={b.name} className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
            <MonthlyBars monthly={b.monthly} color={b.color} name={b.name} />
          </div>
        ))}
      </div>

      {/* 52-week timeline */}
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5 mb-8">
        <h3 className="text-xs font-semibold text-gray-400 mb-4">52-Week Pay Timeline</h3>
        <div className="space-y-5">
          {breakdowns.map((b) => (
            <PayTimeline
              key={b.name}
              weekly={b.weekly}
              biweekly={b.biweekly}
              label={`${b.name} — $${fmt(b.weekly)}/wk`}
              color={b.color}
            />
          ))}
        </div>
      </div>

      {/* Quick insights */}
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5 mb-8">
        <h3 className="text-xs font-semibold text-gray-400 mb-4">Quick Insights</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {[
            {
              label: "Mercy earns per week",
              value: `$${fmt(breakdowns[1].weekly)}`,
              sub: `${mercyPercent}% of Sam's $${fmt(breakdowns[0].weekly)}/wk`,
            },
            {
              label: "Sam earns per day",
              value: `$${fmt(breakdowns[0].daily)}`,
              sub: `Based on 365-day year`,
            },
            {
              label: "Combined hourly rate",
              value: `$${fmt(totalBreakdown.hourly)}`,
              sub: `Assuming 40hr work weeks`,
            },
            {
              label: "Mercy's monthly cost",
              value: `$${fmt(breakdowns[1].monthly)}`,
              sub: `${breakdowns[1].percentOfTotal.toFixed(1)}% of total payroll`,
            },
            {
              label: "Annual payroll total",
              value: `$${fmt(totalBreakdown.annual)}`,
              sub: `Sam + Mercy combined`,
            },
            {
              label: "Ratio",
              value: `${(samAnnual / mercyAnnual).toFixed(1)}x`,
              sub: `Sam earns ${(samAnnual / mercyAnnual).toFixed(1)}x Mercy's pay`,
            },
          ].map((insight) => (
            <div key={insight.label} className="bg-white/[0.03] rounded-lg p-3">
              <div className="text-[9px] text-gray-500 uppercase tracking-wider mb-1">{insight.label}</div>
              <div className="text-sm font-bold text-white tabular-nums">{insight.value}</div>
              <div className="text-[10px] text-gray-500 mt-0.5">{insight.sub}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
