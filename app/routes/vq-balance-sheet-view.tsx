import { useState } from "react";

export const accent = "#8b5cf6";

export function fmt(n: number) {
  const abs = Math.abs(n);
  const formatted = abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n < 0 ? `-$${formatted}` : `$${formatted}`;
}

export function fmtCompact(n: number) {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${n < 0 ? "-" : ""}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${n < 0 ? "-" : ""}$${(abs / 1_000).toFixed(1)}K`;
  return fmt(n);
}

// ============================================================
// BALANCE SHEET DATA
// ============================================================

export const bankAccounts = [
  { code: "10110", name: "Petty Cash Fund", value: 28696.97 },
  { code: "10181", name: "Citizens Checking (8235)", value: 14175.77 },
  { code: "10187", name: "BMO Reserve (9168)", value: 3886666.83 },
  { code: "10188", name: "BMO Grant Money Market (4349)", value: 2256786.23 },
  { code: "10189", name: "BMO FSA Checking (4570)", value: -1726.36 },
  { code: "10192", name: "BMO Operating Checking (2203) (BWAP)", value: 164084.08 },
  { code: "10195", name: "BMO Contingency (7769)", value: 269657.14 },
  { code: "10196", name: "BMO Grant Checking (BWGR) (4831)", value: 144515.57 },
  { code: "10197", name: "BMO Checking Insurance Sweep (4763)", value: 0 },
  { code: "10198", name: "PEX Cash Account", value: -44590.25 },
  { code: "10200", name: "Mercury Operating (7081)", value: 26174.92 },
  { code: "10201", name: "Rippling Credit Account", value: -60346.34 },
  { code: "10299", name: "Rippling Bill Clearing", value: -28970.0 },
  { code: "1072", name: "Bill.com Money Out Clearing", value: 1960.0 },
];
export const totalBank = 6657084.56;

export const accountsReceivable = [{ code: "12013", name: "Accounts receivable", value: 1177177.36 }];
export const totalAR = 1177177.36;

export const otherCurrentAssets = [
  { code: "12115", name: "Unapplied Cash", value: -97586.33 },
  { code: "12430", name: "Allowance for Doubtful Accounts", value: -399909.19 },
  { code: "13000", name: "Employee Reimbursements", value: 0 },
  { code: "14110", name: "Prepaid Vendor Allocations", value: -7885.71 },
  { code: "14120", name: "Prepaid Rent", value: 582448.88 },
  { code: "14130", name: "Prepaid Insurance", value: 2310025.68 },
  { code: "14140", name: "Prepaid Misc", value: -423997.61 },
  { code: "14160", name: "Work Comp Loss Fund", value: 10766.71 },
  { code: "14510", name: "Short Term Deposits", value: 15077.5 },
];
export const totalOtherCurrent = 1988939.93;
export const totalCurrentAssets = 9823201.85;

export const fixedAssets = [
  { code: "15150", name: "Leasehold Improvements", value: 423938.53 },
  { code: "15160", name: "Vehicles", value: 10565.4 },
  { code: "16150", name: "Acc Amortization, Leasehold Imp", value: -423938.53 },
  { code: "16160", name: "Acc Depr, Vehicles", value: -4842.46 },
];
export const totalFixed = 5722.94;

export const otherAssets = [
  { code: "17800", name: "ROU Asset Operating", value: 13878954.0 },
  { code: "17801", name: "ROU Asset Operating Accum Amort", value: -6413938.0 },
  { code: "18120", name: "Long Term Deposits", value: 98332.77 },
];
export const totalOther = 7563348.77;
export const totalAssets = 17392273.56;

export const accountsPayable = [{ code: "20110", name: "Accounts Payable", value: 72196.92 }];
export const totalAP = 72196.92;

export const otherCurrentLiabilities = [
  { code: "20116", name: "Sage Payables", value: 241253.08 },
  { code: "20117", name: "Old Sage AP to write off", value: 231557.79 },
  { code: "20130", name: "Accrued Property Taxes", value: 5873.95 },
  { code: "20155", name: "Insurance Financing", value: 202587.02 },
  { code: "20187", name: "Youth Allowance Maryland", value: 2170.87 },
  { code: "20299", name: "Deferred Revenue", value: 1138.61 },
  { code: "20300", name: "Deferred Revenue UC 875/876 Grants", value: 82637.8 },
  { code: "20301", name: "Deferred Revenue UC 877 CA Grant", value: 1241762.7 },
  { code: "20302", name: "Deferred Revenue UC 878 TX Grant", value: 1551097.16 },
  { code: "20303", name: "Deferred Revenue UC 879 NM Grant", value: -79567.78 },
  { code: "20304", name: "Deferred Revenue UC 880 AZ Grant", value: -53134.28 },
  { code: "20305", name: "Deferred Revenue UC 881 LTFC AZ Grant", value: 135294.27 },
  { code: "20306", name: "Deferred Revenue UC 882 Wallis Grant", value: -125005.58 },
  { code: "20307", name: "Deferred Revenue UC 883 Gwen Mikeal", value: 218768.87 },
  { code: "20308", name: "Deferred Revenue UC 884 Sam Mahan", value: 222980.31 },
  { code: "20309", name: "Deferred Revenue TX FFT 657", value: -0.2 },
  { code: "20311", name: "Deferred Revenue UC 885 GRACE DIX VILLAGE", value: 601052.4 },
  { code: "20312", name: "Deferred Revenue UC 886 JDC", value: 493056.54 },
  { code: "20313", name: "Deferred Revenue UC 887 DON BARNES CENTER", value: 181362.19 },
  { code: "20314", name: "Deferred Revenue UC 888 STEVE ROGERS VILLAGE", value: 269266.15 },
  { code: "22228", name: "Delaware Training Tax", value: 566.1 },
  { code: "22231", name: "FLI Family Leave Insurance Withholding", value: 450.58 },
  { code: "22232", name: "Wilmington Business License Fee", value: 1845.0 },
  { code: "22372", name: "Payflex Plan Payroll Liability", value: -1906.79 },
  { code: "22376", name: "CIGNA Group Medical", value: 492827.26 },
  { code: "22379", name: "Cigna Dental and Vision", value: -9064.91 },
  { code: "22383", name: "Group Life Ins & STD Accrual", value: 12998.48 },
  { code: "22430", name: "Employee Reimbursements Payable", value: 19844.18 },
  { code: "22435", name: "401K Loan Repayment", value: 19854.93 },
  { code: "22440", name: "401K Contributions", value: 39009.21 },
  { code: "22499", name: "Payroll Suspense Liability", value: 87.17 },
  { code: "22700", name: "Supplemental Wages", value: -19440.64 },
  { code: "22701", name: "VQ Deferred Compensation", value: 66666.67 },
  { code: "22998", name: "Payroll Incurred not Paid", value: 3800.25 },
  { code: "22999", name: "Payroll Accrual Liability", value: 0 },
  { code: "26042", name: "Grace Dix Stock Repurchase", value: 5277.24 },
  { code: "26750", name: "ROU Lease Liability Operating ST", value: 5262708.0 },
];
export const totalOtherCurrentLiab = 11319674.6;
export const totalCurrentLiab = 11391871.52;

export const longTermLiab = [
  { code: "26722", name: "Note Payable Bob Burton 3.30.23", value: 2085670.96 },
  { code: "26751", name: "ROU Lease Liability Operating LT", value: 1910378.0 },
  { code: "27325", name: "Third Party Settlement", value: 383330.78 },
];
export const totalLongTermLiab = 4379379.74;
export const totalLiabilities = 15771251.26;

export const equity = [
  { code: "31110", name: "Common stock", value: 1444543.33 },
  { code: "31120", name: "Additional paid in capital", value: 160014.69 },
  { code: "31210", name: "Retained Earnings", value: -466.42 },
  { code: "31300", name: "Treasury stock", value: -5836850.09 },
  { code: "31500", name: "Deferred Comp Obligation", value: 936472.43 },
  { code: "", name: "Opening balance equity", value: 6557006.86 },
  { code: "", name: "Net Income", value: -1639698.5 },
];
export const totalEquity = 1621022.3;
export const totalLiabilitiesEquity = 17392273.56;
