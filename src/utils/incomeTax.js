/** FY 2026-27 / AY 2027-28 income-tax engine (India). */

function currentFinancialYear(date = new Date()) {
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  return m >= 4 ? `${y}-${String(y + 1).slice(-2)}` : `${y - 1}-${String(y).slice(-2)}`;
}

function fyBounds(financialYear) {
  const startYear = parseInt(String(financialYear).slice(0, 4), 10);
  return {
    start: new Date(Date.UTC(startYear, 3, 1)),
    end: new Date(Date.UTC(startYear + 1, 2, 31, 23, 59, 59)),
    startYear,
  };
}

const NEW_SLABS = [
  [400000, 0],
  [800000, 0.05],
  [1200000, 0.1],
  [1600000, 0.15],
  [2000000, 0.2],
  [2400000, 0.25],
  [Infinity, 0.3],
];

const OLD_SLABS = [
  [250000, 0],
  [500000, 0.05],
  [1000000, 0.2],
  [Infinity, 0.3],
];

function taxOnSlabs(income, slabs) {
  let remaining = Math.max(0, Number(income) || 0);
  let prev = 0;
  let tax = 0;
  for (const [upto, rate] of slabs) {
    const band = Math.max(0, Math.min(remaining, upto - prev));
    tax += band * rate;
    remaining -= band;
    prev = upto;
    if (remaining <= 0) break;
  }
  return Math.round(tax);
}

function hraExemption({ annualHra, annualBasic, rentPaidAnnual, isMetro }) {
  if (!rentPaidAnnual || rentPaidAnnual <= 0) return 0;
  const excessRent = Math.max(0, rentPaidAnnual - annualBasic * 0.1);
  const metroCap = annualBasic * (isMetro ? 0.5 : 0.4);
  return Math.round(Math.min(annualHra, excessRent, metroCap));
}

function computeAnnualTax({
  annualGross,
  annualBasic = 0,
  annualHra = 0,
  regime = "NEW",
  declaration = {},
}) {
  const isOld = String(regime).toUpperCase() === "OLD";
  const standardDeduction = isOld ? 50000 : 75000;
  const d80c = Math.min(Number(declaration.section80C || 0), 150000);
  const d80d = Math.min(Number(declaration.section80D || 0), 25000);
  const homeLoan = Math.min(Number(declaration.homeLoanInterest || 0), 200000);
  const nps = Math.min(Number(declaration.npsEmployee || 0), 50000);
  const other = Number(declaration.otherExemptions || 0);
  const prevIncome = Number(declaration.previousEmployerIncome || 0);
  const prevTds = Number(declaration.previousEmployerTds || 0);

  let exemptions = standardDeduction;
  if (isOld) {
    exemptions += d80c + d80d + homeLoan;
    exemptions += hraExemption({
      annualHra,
      annualBasic,
      rentPaidAnnual: Number(declaration.rentPaidAnnual || 0),
      isMetro: declaration.isMetro !== false,
    });
  }
  exemptions += nps + other;

  const gross = Number(annualGross || 0) + prevIncome;
  const taxableIncome = Math.max(0, Math.round(gross - exemptions));
  let taxOnIncome = taxOnSlabs(taxableIncome, isOld ? OLD_SLABS : NEW_SLABS);
  let rebate87A = 0;

  if (!isOld) {
    if (taxableIncome <= 1200000) {
      rebate87A = taxOnIncome;
      taxOnIncome = 0;
    } else {
      const excess = taxableIncome - 1200000;
      if (taxOnIncome > excess) {
        rebate87A = taxOnIncome - excess;
        taxOnIncome = excess;
      }
    }
  } else if (taxableIncome <= 500000) {
    rebate87A = Math.min(taxOnIncome, 12500);
    taxOnIncome = Math.max(0, taxOnIncome - rebate87A);
  }

  const cess = Math.round(taxOnIncome * 0.04);
  const totalTax = taxOnIncome + cess;
  const tdsRemaining = Math.max(0, totalTax - prevTds);
  const monthlyTds = Math.round(tdsRemaining / 12);

  return {
    financialYearNote: "FY 2026-27 / AY 2027-28",
    regime: isOld ? "OLD" : "NEW",
    annualGross: Math.round(gross),
    standardDeduction,
    exemptions: Math.round(exemptions),
    taxableIncome,
    taxOnIncome,
    rebate87A,
    cess,
    totalTax,
    previousEmployerTds: prevTds,
    tdsRemaining,
    monthlyTds,
  };
}

module.exports = {
  currentFinancialYear,
  fyBounds,
  computeAnnualTax,
  hraExemption,
};
