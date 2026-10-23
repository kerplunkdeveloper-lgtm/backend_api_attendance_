const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { mockPrisma } = require("./helpers/mockPrisma");

let slips;
const saved = [];

mockPrisma({
  payslip: { findMany: async () => slips },
  statutoryExport: {
    create: async ({ data }) => {
      saved.push(data);
      return { id: "exp-1", ...data };
    },
  },
});

const statutory = require("../src/services/statutory.service");

const slip = (overrides = {}) => ({
  grossSalary: 30000,
  baseSalary: 20000,
  pfDeduction: 1800,
  esiDeduction: 0,
  workingDays: 26,
  netSalary: 25000,
  employee: { firstName: "Priya", lastName: "N", employeeCode: "E1", uanNumber: "100200300400", esiNumber: "", bankName: "B", bankAccountNumber: "1", bankIfsc: "I" },
  ...overrides,
});

describe("PF ECR export", () => {
  beforeEach(() => {
    slips = [slip()];
  });

  it("writes the EPF-EPS difference, not the 0.5% admin rate", async () => {
    const { content } = await statutory.exportPfEcr("org-1", 9, 2026, "u1");
    const fields = content.split("#");
    const epfWage = 15000; // base 20000 is capped at the 15,000 ceiling
    const eps = Math.round(epfWage * 0.0833);
    assert.equal(Number(fields[6]), 1800); // EPF contribution remitted
    assert.equal(Number(fields[7]), eps); // EPS contribution
    assert.equal(Number(fields[8]), 1800 - eps); // EPF-EPS difference
    assert.notEqual(Number(fields[8]), Math.round(epfWage * 0.005));
  });

  it("keeps '#' in a name from breaking the field layout", async () => {
    slips = [slip({ employee: { ...slip().employee, firstName: "Pri#ya" } })];
    const { content } = await statutory.exportPfEcr("org-1", 9, 2026, "u1");
    assert.equal(content.split("#").length, 11);
  });
});

describe("ESI export", () => {
  it("lists only employees who actually have an ESI deduction", async () => {
    slips = [
      slip({ grossSalary: 18000, esiDeduction: 135, employee: { ...slip().employee, firstName: "Covered" } }),
      slip({ grossSalary: 45000, esiDeduction: 0, employee: { ...slip().employee, firstName: "AboveCeiling" } }),
    ];
    const result = await statutory.exportEsi("org-1", 9, 2026, "u1");
    assert.equal(result.rowCount, 1);
    assert.match(result.content, /Covered/);
    assert.doesNotMatch(result.content, /AboveCeiling/);
  });
});

describe("Form 16 HTML", () => {
  it("escapes user-entered names so they cannot inject markup", () => {
    const html = statutory.form16Html({
      financialYear: "2026-27",
      employee: { name: '<img src=x onerror="alert(1)">', employeeCode: "E<1>", panNumber: "", organizationName: "<script>x</script>" },
      declaration: { regime: "NEW", status: "DRAFT" },
      tax: { financialYearNote: "", regime: "NEW", annualGross: 1, standardDeduction: 1, exemptions: 1, taxableIncome: 1, taxOnIncome: 1, rebate87A: 1, cess: 1, totalTax: 1, tdsDeducted: 1, taxPayable: 1 },
    });
    assert.doesNotMatch(html, /<script>x/);
    assert.doesNotMatch(html, /<img src=x/);
    assert.match(html, /&lt;script&gt;/);
  });
});
