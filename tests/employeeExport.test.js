const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { mockPrisma, stubSideEffects } = require("./helpers/mockPrisma");

stubSideEffects();

let lastArgs;
mockPrisma({
  employee: {
    findMany: async (args) => {
      lastArgs = args;
      return [
        {
          employeeCode: "E1", firstName: "=HYPERLINK(\"http://evil\",\"x\")", lastName: "Nair", workEmail: "a@b.c", phone: "999",
          designation: "Dev", employmentType: "FULL_TIME", status: "NOTICE_PERIOD", dateOfJoining: new Date("2024-03-05T00:00:00Z"),
          department: { name: "Eng" }, branch: { name: "HQ" }, shift: { name: "Day" }, user: { email: "a@b.c", role: "EMPLOYEE" },
        },
      ];
    },
  },
});

const employeeService = require("../src/services/employee.service");

describe("employee directory export", () => {
  it("is scoped to the organization and includes people serving notice for WORKING", async () => {
    await employeeService.exportEmployeesCsv("org-1", { status: "WORKING" });
    assert.equal(lastArgs.where.organizationId, "org-1");
    assert.deepEqual(lastArgs.where.status, { in: ["ACTIVE", "PROBATION", "NOTICE_PERIOD"] });
  });

  it("ignores an unknown status instead of passing it to the database", async () => {
    await employeeService.exportEmployeesCsv("org-1", { status: "HACKED" });
    assert.equal(lastArgs.where.status, undefined);
  });

  it("neutralises formulas in names and writes the expected columns", async () => {
    const file = await employeeService.exportEmployeesCsv("org-1", {});
    const [header, row] = file.content.split("\n");
    assert.match(header, /^Employee code,First name,Last name,Email,Phone,Department/);
    assert.ok(row.includes("\"'=HYPERLINK"), row);
    assert.match(row, /2024-03-05$/);
    assert.equal(file.rowCount, 1);
    assert.match(file.fileName, /^employees_\d{4}-\d{2}-\d{2}\.csv$/);
  });

  it("never selects salary, PAN or bank fields", async () => {
    await employeeService.exportEmployeesCsv("org-1", {});
    const selected = Object.keys(lastArgs.select);
    for (const sensitive of ["panNumber", "bankAccountNumber", "bankIfsc", "uanNumber", "salaryStructure", "dateOfBirth"]) {
      assert.ok(!selected.includes(sensitive), sensitive);
    }
  });
});
