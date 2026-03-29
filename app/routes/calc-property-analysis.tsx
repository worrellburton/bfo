import { useState } from "react";
import { Link } from "react-router";

export function meta() {
  return [{ title: "BFO - Property Analysis: 1344 Tydings Rd" }];
}

function fmt(n: number) {
  return n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function fmtDec(n: number) {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function pct(n: number) {
  return `${n.toFixed(1)}%`;
}

// Horizontal gauge bar
function GaugeBar({ label, value, max, color, suffix = "" }: { label: string; value: number; max: number; color: string; suffix?: string }) {
  const p = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[10px]">
        <span className="text-gray-400">{label}</span>
        <span className="text-gray-300 font-medium tabular-nums">{typeof value === "number" && !suffix ? `$${fmt(value)}` : `${fmt(value)}${suffix}`}</span>
      </div>
      <div className="h-2 bg-white/5 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all duration-700" style={{ width: `${p}%`, background: color }} />
      </div>
    </div>
  );
}

// Stat card
function StatCard({ label, value, sub, color }: { label: string; value: string; sub: string; color?: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
      <div className="text-[9px] text-gray-500 uppercase tracking-wider mb-1">{label}</div>
      <div className="text-lg font-bold tabular-nums" style={color ? { color } : undefined}>{value}</div>
      <div className="text-[10px] text-gray-500 mt-0.5">{sub}</div>
    </div>
  );
}

// Mini SVG bar chart
function ValueChart({ data, height = 120 }: { data: { label: string; value: number; color: string }[]; height?: number }) {
  const max = Math.max(...data.map((d) => d.value));
  return (
    <div className="flex items-end gap-3" style={{ height }}>
      {data.map((d) => (
        <div key={d.label} className="flex-1 flex flex-col items-center gap-1">
          <span className="text-[9px] text-gray-400 tabular-nums">${fmt(d.value)}</span>
          <div
            className="w-full rounded-t transition-all duration-500"
            style={{
              height: `${(d.value / max) * (height - 30)}px`,
              background: `linear-gradient(180deg, ${d.color} 0%, ${d.color}60 100%)`,
            }}
          />
          <span className="text-[8px] text-gray-500 text-center leading-tight">{d.label}</span>
        </div>
      ))}
    </div>
  );
}

// Donut chart
function DonutChart({ slices, size = 140 }: { slices: { value: number; color: string; label: string }[]; size?: number }) {
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
            <title>{sl.label}: ${fmtDec(sl.value)}</title>
          </path>
        );
      })}
      <circle cx={cx} cy={cy} r={22} fill="#0a0a0a" />
    </svg>
  );
}

// Property data
const property = {
  address: "1344 Tydings Rd",
  city: "Annapolis",
  state: "MD",
  zip: "21409",
  county: "Anne Arundel",
  yearBuilt: 1983,
  sqft: 5372,
  aboveGradeSqft: 4964,
  finishedBasementSqft: 408,
  lotAcres: 1.27,
  lotSqft: 55321,
  bedrooms: 4,
  bathrooms: 4.5,
  stories: 2,
  garage: "2-car",
  pool: "40x18 heated saltwater",
  style: "Italian Villa",
  roof: "Terracotta tile",
  exterior: "Hand chipped stone & stucco",
  lastSaleDate: "Jul 16, 2020",
  lastSalePrice: 1200000,
  prevSaleDate: "Jun 30, 2017",
  prevSalePrice: 1162500,
  estimatedValue: 1548588,
  pricePerSqft: 288,
  assessedLand: 224700,
  assessedBuilding: 715400,
  assessedTotal: 940100,
  schools: {
    elementary: "Cape St. Claire Elementary",
    middle: "Magothy River Middle",
    high: "Broadneck High",
  },
  medianAreaPrice: 630000,
};

export default function PropertyAnalysis() {
  const [purchasePrice, setPurchasePrice] = useState(property.estimatedValue);
  const [downPaymentPct, setDownPaymentPct] = useState(20);
  const [interestRate, setInterestRate] = useState(6.5);
  const [loanTermYears, setLoanTermYears] = useState(30);

  // Mortgage calculations
  const downPayment = purchasePrice * (downPaymentPct / 100);
  const loanAmount = purchasePrice - downPayment;
  const monthlyRate = interestRate / 100 / 12;
  const numPayments = loanTermYears * 12;
  const monthlyMortgage = monthlyRate > 0
    ? (loanAmount * monthlyRate * Math.pow(1 + monthlyRate, numPayments)) / (Math.pow(1 + monthlyRate, numPayments) - 1)
    : loanAmount / numPayments;

  // Estimated monthly costs
  const annualTaxRate = 1.056; // Anne Arundel county rate ~$1.056 per $100
  const monthlyTax = (purchasePrice * (annualTaxRate / 100)) / 12;
  const monthlyInsurance = (purchasePrice * 0.0035) / 12; // ~0.35% of home value
  const monthlyHOA = 0;
  const totalMonthly = monthlyMortgage + monthlyTax + monthlyInsurance + monthlyHOA;

  // Total cost of loan
  const totalLoanCost = monthlyMortgage * numPayments;
  const totalInterest = totalLoanCost - loanAmount;

  // Appreciation estimates
  const annualAppreciation = 2.4; // based on current Annapolis market
  const valueIn5 = purchasePrice * Math.pow(1 + annualAppreciation / 100, 5);
  const valueIn10 = purchasePrice * Math.pow(1 + annualAppreciation / 100, 10);
  const valueIn20 = purchasePrice * Math.pow(1 + annualAppreciation / 100, 20);
  const equityIn5 = valueIn5 - loanAmount * (1 - 5 / loanTermYears * 0.35); // rough estimate
  const appreciation5 = valueIn5 - purchasePrice;
  const appreciation10 = valueIn10 - purchasePrice;

  // Sale history appreciation
  const saleAppreciation = ((property.lastSalePrice - property.prevSalePrice) / property.prevSalePrice) * 100;
  const annualSaleAppreciation = saleAppreciation / 3; // ~3 years between sales
  const currentAppFromSale = ((property.estimatedValue - property.lastSalePrice) / property.lastSalePrice) * 100;

  return (
    <div className="max-w-5xl">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-xs text-gray-500 mb-4">
        <Link to="/tools" className="hover:text-white transition-colors">Tools</Link>
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        <span className="text-gray-300">Property Analysis</span>
      </div>

      <h1 className="text-2xl font-bold mb-1">Property Analysis</h1>
      <p className="text-gray-500 text-sm mb-6">1344 Tydings Rd, Annapolis, MD 21409</p>

      {/* Property Overview Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-8">
        <StatCard label="Est. Value" value={`$${fmt(property.estimatedValue)}`} sub={`$${property.pricePerSqft}/sqft`} color="#10b981" />
        <StatCard label="Last Sale" value={`$${fmt(property.lastSalePrice)}`} sub={property.lastSaleDate} />
        <StatCard label="Sq Footage" value={fmt(property.sqft)} sub={`${property.lotAcres} acre lot`} />
        <StatCard label="Bed / Bath" value={`${property.bedrooms} / ${property.bathrooms}`} sub={`${property.stories}-story`} />
        <StatCard label="Year Built" value={`${property.yearBuilt}`} sub={`${new Date().getFullYear() - property.yearBuilt} years old`} />
        <StatCard label="Appreciation" value={pct(currentAppFromSale)} sub="Since last sale" color="#6366f1" />
      </div>

      {/* Property Details & Features */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-8">
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
          <h3 className="text-xs font-semibold text-gray-400 mb-4">Property Details</h3>
          <div className="space-y-2.5">
            {[
              ["Style", property.style],
              ["Exterior", property.exterior],
              ["Roof", property.roof],
              ["Above Grade", `${fmt(property.aboveGradeSqft)} sqft`],
              ["Finished Basement", `${fmt(property.finishedBasementSqft)} sqft`],
              ["Lot Size", `${property.lotAcres} acres (${fmt(property.lotSqft)} sqft)`],
              ["Garage", property.garage],
              ["Pool", property.pool],
              ["County", property.county],
              ["ZIP", property.zip],
            ].map(([label, val]) => (
              <div key={label} className="flex justify-between text-xs">
                <span className="text-gray-500">{label}</span>
                <span className="text-gray-300 font-medium">{val}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
          <h3 className="text-xs font-semibold text-gray-400 mb-4">Key Features</h3>
          <div className="space-y-2">
            {[
              "Gourmet kitchen w/ honed granite & chef grade SS appliances",
              "Reclaimed hardwood & imported Italian tile flooring",
              "Grand loggia w/ outdoor stone facade wood fireplace",
              "40x18 heated saltwater pool w/ water fountain",
              "Master suite w/ 10ft ceilings & spa-like bathroom",
              "Custom doors, windows & plantation shutters",
              "Bonus room w/ half bath above garage (in-law suite)",
              "Expansive rear flat grassy yard w/ mature trees",
            ].map((f) => (
              <div key={f} className="flex items-start gap-2 text-xs text-gray-400">
                <svg className="w-3 h-3 text-emerald-500 mt-0.5 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                <span>{f}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Sale History & Value */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-8">
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
          <h3 className="text-xs font-semibold text-gray-400 mb-4">Sale History</h3>
          <ValueChart
            data={[
              { label: `Sold\n${property.prevSaleDate}`, value: property.prevSalePrice, color: "#6366f1" },
              { label: `Sold\n${property.lastSaleDate}`, value: property.lastSalePrice, color: "#8b5cf6" },
              { label: "Est.\nToday", value: property.estimatedValue, color: "#10b981" },
            ]}
          />
          <div className="mt-4 space-y-1.5">
            <div className="flex justify-between text-[10px]">
              <span className="text-gray-500">2017 to 2020</span>
              <span className="text-emerald-400 font-medium">+{pct(saleAppreciation)} ({pct(annualSaleAppreciation)}/yr)</span>
            </div>
            <div className="flex justify-between text-[10px]">
              <span className="text-gray-500">2020 to today</span>
              <span className="text-emerald-400 font-medium">+{pct(currentAppFromSale)}</span>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
          <h3 className="text-xs font-semibold text-gray-400 mb-4">Market Comparison</h3>
          <div className="space-y-4">
            <GaugeBar label="This Property" value={property.estimatedValue} max={2000000} color="#10b981" />
            <GaugeBar label="Area Median (21409)" value={property.medianAreaPrice} max={2000000} color="#6366f1" />
            <GaugeBar label="Price/sqft (This)" value={property.pricePerSqft} max={500} color="#f59e0b" suffix="/sqft" />
            <GaugeBar label="Price/sqft (Area)" value={343} max={500} color="#8b5cf6" suffix="/sqft" />
          </div>
          <div className="mt-4 bg-white/[0.03] rounded-lg p-3">
            <div className="text-[9px] text-gray-500 uppercase tracking-wider mb-1">vs Area Median</div>
            <div className="text-sm font-bold text-amber-400 tabular-nums">
              {fmt(Math.round(((property.estimatedValue - property.medianAreaPrice) / property.medianAreaPrice) * 100))}% above
            </div>
            <div className="text-[10px] text-gray-500 mt-0.5">
              ${fmt(property.estimatedValue - property.medianAreaPrice)} over 21409 median
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
          <h3 className="text-xs font-semibold text-gray-400 mb-4">Tax Assessment</h3>
          <DonutChart
            slices={[
              { value: property.assessedLand, color: "#6366f1", label: "Land" },
              { value: property.assessedBuilding, color: "#10b981", label: "Building" },
            ]}
            size={120}
          />
          <div className="flex gap-4 mt-3 justify-center">
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-sm" style={{ background: "#6366f1" }} />
              <span className="text-[10px] text-gray-400">Land ${fmt(property.assessedLand)}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-sm" style={{ background: "#10b981" }} />
              <span className="text-[10px] text-gray-400">Building ${fmt(property.assessedBuilding)}</span>
            </div>
          </div>
          <div className="mt-3 text-center">
            <div className="text-[9px] text-gray-500 uppercase tracking-wider">Total Assessed</div>
            <div className="text-sm font-bold tabular-nums">${fmt(property.assessedTotal)}</div>
            <div className="text-[10px] text-gray-500">Tax rate: ${annualTaxRate}/$100</div>
          </div>
        </div>
      </div>

      {/* Mortgage Calculator */}
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5 mb-8">
        <h3 className="text-xs font-semibold text-gray-400 mb-5">Mortgage Calculator</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {/* Purchase Price */}
          <div>
            <div className="flex justify-between mb-1">
              <span className="text-[10px] text-gray-500">Purchase Price</span>
              <span className="text-xs font-bold tabular-nums">${fmt(purchasePrice)}</span>
            </div>
            <input
              type="range"
              min={800000}
              max={2200000}
              step={10000}
              value={purchasePrice}
              onChange={(e) => setPurchasePrice(Number(e.target.value))}
              className="w-full accent-[#10b981]"
            />
            <div className="flex justify-between text-[8px] text-gray-600 mt-0.5">
              <span>$800k</span>
              <span>$2.2M</span>
            </div>
          </div>

          {/* Down Payment */}
          <div>
            <div className="flex justify-between mb-1">
              <span className="text-[10px] text-gray-500">Down Payment</span>
              <span className="text-xs font-bold tabular-nums">{downPaymentPct}% (${fmt(Math.round(downPayment))})</span>
            </div>
            <input
              type="range"
              min={3}
              max={50}
              step={1}
              value={downPaymentPct}
              onChange={(e) => setDownPaymentPct(Number(e.target.value))}
              className="w-full accent-[#6366f1]"
            />
            <div className="flex justify-between text-[8px] text-gray-600 mt-0.5">
              <span>3%</span>
              <span>50%</span>
            </div>
          </div>

          {/* Interest Rate */}
          <div>
            <div className="flex justify-between mb-1">
              <span className="text-[10px] text-gray-500">Interest Rate</span>
              <span className="text-xs font-bold tabular-nums">{interestRate.toFixed(1)}%</span>
            </div>
            <input
              type="range"
              min={2}
              max={10}
              step={0.1}
              value={interestRate}
              onChange={(e) => setInterestRate(Number(e.target.value))}
              className="w-full accent-[#f59e0b]"
            />
            <div className="flex justify-between text-[8px] text-gray-600 mt-0.5">
              <span>2%</span>
              <span>10%</span>
            </div>
          </div>

          {/* Loan Term */}
          <div>
            <div className="flex justify-between mb-1">
              <span className="text-[10px] text-gray-500">Loan Term</span>
              <span className="text-xs font-bold tabular-nums">{loanTermYears} years</span>
            </div>
            <input
              type="range"
              min={10}
              max={30}
              step={5}
              value={loanTermYears}
              onChange={(e) => setLoanTermYears(Number(e.target.value))}
              className="w-full accent-[#8b5cf6]"
            />
            <div className="flex justify-between text-[8px] text-gray-600 mt-0.5">
              <span>10yr</span>
              <span>30yr</span>
            </div>
          </div>
        </div>

        {/* Monthly Payment Breakdown */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <div className="bg-white/[0.03] rounded-lg p-3">
            <div className="text-[9px] text-gray-500 uppercase tracking-wider mb-1">P&I</div>
            <div className="text-sm font-bold tabular-nums" style={{ color: "#10b981" }}>${fmt(Math.round(monthlyMortgage))}</div>
            <div className="text-[10px] text-gray-500">Principal & interest</div>
          </div>
          <div className="bg-white/[0.03] rounded-lg p-3">
            <div className="text-[9px] text-gray-500 uppercase tracking-wider mb-1">Property Tax</div>
            <div className="text-sm font-bold tabular-nums" style={{ color: "#6366f1" }}>${fmt(Math.round(monthlyTax))}</div>
            <div className="text-[10px] text-gray-500">{pct(annualTaxRate)} annual</div>
          </div>
          <div className="bg-white/[0.03] rounded-lg p-3">
            <div className="text-[9px] text-gray-500 uppercase tracking-wider mb-1">Insurance</div>
            <div className="text-sm font-bold tabular-nums" style={{ color: "#f59e0b" }}>${fmt(Math.round(monthlyInsurance))}</div>
            <div className="text-[10px] text-gray-500">Est. 0.35%</div>
          </div>
          <div className="bg-white/[0.03] rounded-lg p-3">
            <div className="text-[9px] text-gray-500 uppercase tracking-wider mb-1">Total Interest</div>
            <div className="text-sm font-bold tabular-nums" style={{ color: "#ef4444" }}>${fmt(Math.round(totalInterest))}</div>
            <div className="text-[10px] text-gray-500">Over loan life</div>
          </div>
          <div className="bg-white/[0.03] rounded-lg p-3 border border-white/10">
            <div className="text-[9px] text-gray-500 uppercase tracking-wider mb-1">Total Monthly</div>
            <div className="text-lg font-bold tabular-nums text-white">${fmt(Math.round(totalMonthly))}</div>
            <div className="text-[10px] text-gray-500">${fmt(Math.round(totalMonthly * 12))}/year</div>
          </div>
        </div>
      </div>

      {/* Appreciation Projections */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-8">
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
          <h3 className="text-xs font-semibold text-gray-400 mb-4">Projected Value ({pct(annualAppreciation)}/yr)</h3>
          <ValueChart
            data={[
              { label: "Today", value: purchasePrice, color: "#6366f1" },
              { label: "5 Years", value: Math.round(valueIn5), color: "#8b5cf6" },
              { label: "10 Years", value: Math.round(valueIn10), color: "#10b981" },
              { label: "20 Years", value: Math.round(valueIn20), color: "#f59e0b" },
            ]}
            height={140}
          />
          <div className="mt-4 grid grid-cols-3 gap-2">
            <div className="bg-white/[0.03] rounded-lg p-2 text-center">
              <div className="text-[8px] text-gray-500">5yr gain</div>
              <div className="text-xs font-bold text-emerald-400 tabular-nums">+${fmt(Math.round(appreciation5))}</div>
            </div>
            <div className="bg-white/[0.03] rounded-lg p-2 text-center">
              <div className="text-[8px] text-gray-500">10yr gain</div>
              <div className="text-xs font-bold text-emerald-400 tabular-nums">+${fmt(Math.round(appreciation10))}</div>
            </div>
            <div className="bg-white/[0.03] rounded-lg p-2 text-center">
              <div className="text-[8px] text-gray-500">20yr value</div>
              <div className="text-xs font-bold text-amber-400 tabular-nums">${fmt(Math.round(valueIn20))}</div>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
          <h3 className="text-xs font-semibold text-gray-400 mb-4">Cost Breakdown (Monthly)</h3>
          <div className="flex items-center gap-6">
            <DonutChart
              slices={[
                { value: monthlyMortgage, color: "#10b981", label: "P&I" },
                { value: monthlyTax, color: "#6366f1", label: "Tax" },
                { value: monthlyInsurance, color: "#f59e0b", label: "Insurance" },
              ]}
              size={130}
            />
            <div className="space-y-3 flex-1">
              {[
                { label: "Principal & Interest", value: monthlyMortgage, color: "#10b981", pct: (monthlyMortgage / totalMonthly) * 100 },
                { label: "Property Tax", value: monthlyTax, color: "#6366f1", pct: (monthlyTax / totalMonthly) * 100 },
                { label: "Insurance", value: monthlyInsurance, color: "#f59e0b", pct: (monthlyInsurance / totalMonthly) * 100 },
              ].map((item) => (
                <div key={item.label} className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: item.color }} />
                  <div className="flex-1">
                    <div className="flex justify-between text-[10px]">
                      <span className="text-gray-400">{item.label}</span>
                      <span className="text-gray-300 font-medium tabular-nums">${fmt(Math.round(item.value))}</span>
                    </div>
                    <div className="h-1 bg-white/5 rounded-full mt-0.5 overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${item.pct}%`, background: item.color }} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Schools & Location */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-8">
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
          <h3 className="text-xs font-semibold text-gray-400 mb-4">Schools</h3>
          <div className="space-y-3">
            {[
              { level: "Elementary", name: property.schools.elementary, color: "#10b981" },
              { level: "Middle", name: property.schools.middle, color: "#6366f1" },
              { level: "High", name: property.schools.high, color: "#f59e0b" },
            ].map((s) => (
              <div key={s.level} className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center text-[10px] font-bold" style={{ background: `${s.color}20`, color: s.color }}>
                  {s.level[0]}
                </div>
                <div>
                  <div className="text-xs font-medium text-gray-300">{s.name}</div>
                  <div className="text-[10px] text-gray-500">{s.level} School</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
          <h3 className="text-xs font-semibold text-gray-400 mb-4">Location Highlights</h3>
          <div className="space-y-2">
            {[
              "Broadneck Peninsula — Anne Arundel County",
              "Quick access to Sandy Point State Park",
              "Near Bay Bridge to Eastern Shore",
              "Easy Rt. 50 access to Washington, DC",
              "Cape St. Claire community area",
              "Chesapeake Bay proximity",
            ].map((loc) => (
              <div key={loc} className="flex items-center gap-2 text-xs text-gray-400">
                <svg className="w-3 h-3 text-blue-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                <span>{loc}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Quick Insights */}
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5 mb-8">
        <h3 className="text-xs font-semibold text-gray-400 mb-4">Quick Insights</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {[
            {
              label: "Price per acre",
              value: `$${fmt(Math.round(purchasePrice / property.lotAcres))}`,
              sub: `${property.lotAcres} acres total`,
            },
            {
              label: "Annual tax estimate",
              value: `$${fmt(Math.round(monthlyTax * 12))}`,
              sub: `$${fmt(Math.round(monthlyTax))}/month`,
            },
            {
              label: "Down payment needed",
              value: `$${fmt(Math.round(downPayment))}`,
              sub: `${downPaymentPct}% of purchase price`,
            },
            {
              label: "Loan amount",
              value: `$${fmt(Math.round(loanAmount))}`,
              sub: `${loanTermYears}-year term at ${interestRate}%`,
            },
            {
              label: "Cost per bedroom",
              value: `$${fmt(Math.round(purchasePrice / property.bedrooms))}`,
              sub: `${property.bedrooms} bedrooms total`,
            },
            {
              label: "Above area median by",
              value: `$${fmt(purchasePrice - property.medianAreaPrice)}`,
              sub: `Median in 21409: $${fmt(property.medianAreaPrice)}`,
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
