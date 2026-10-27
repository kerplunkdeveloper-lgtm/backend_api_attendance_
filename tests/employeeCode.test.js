const test = require("node:test");
const assert = require("node:assert/strict");
const { getNextEmployeeCode, prefixForRole, organizationPrefix } = require("../src/utils/employeeCode");

const db = (codes) => ({
  employee: {
    findMany: async () => codes.map((employeeCode) => ({ employeeCode })),
  },
});

test("uses one company-wide sequence for HR and employees", async () => {
  assert.equal(prefixForRole("MANAGER"), "HR");
  assert.equal(organizationPrefix("Kerplunk Media"), "KM");
  assert.equal(organizationPrefix("SS Solutions"), "SS");
  assert.equal(await getNextEmployeeCode("org-1", db(["KM001", "KM-HR-002", "KM003"]), "MANAGER", "Kerplunk Media"), "KM004");
  assert.equal(await getNextEmployeeCode("org-1", db(["KM001", "KM-HR-002", "KM003"]), "EMPLOYEE", "Kerplunk Media"), "KM004");
});

test("uses the admin sequence for company admins", async () => {
  assert.equal(prefixForRole("COMPANY_ADMIN"), "ADM");
  assert.equal(await getNextEmployeeCode("org-1", db([]), "COMPANY_ADMIN", "WorkPulse"), "WP001");
});

const dbWithDates = (rows) => ({ employee: { findMany: async () => rows } });

test("a joining date places the code after earlier joiners, in the first free slot", async () => {
  const rows = [
    { employeeCode: "KM001", dateOfJoining: "2024-01-10" },
    { employeeCode: "KM003", dateOfJoining: "2025-06-01" },
  ];
  assert.equal(await getNextEmployeeCode("org-1", dbWithDates(rows), "EMPLOYEE", "Kerplunk Media", "2024-03-01"), "KM002");
});

test("with no free slot, or no joining date, the code goes to the end", async () => {
  const rows = [
    { employeeCode: "KM001", dateOfJoining: "2024-01-10" },
    { employeeCode: "KM002", dateOfJoining: "2025-06-01" },
  ];
  assert.equal(await getNextEmployeeCode("org-1", dbWithDates(rows), "EMPLOYEE", "Kerplunk Media", "2024-03-01"), "KM003");
  assert.equal(await getNextEmployeeCode("org-1", dbWithDates(rows), "EMPLOYEE", "Kerplunk Media"), "KM003");
});

test("someone who joined later does not push the code ahead of earlier joiners", async () => {
  const rows = [{ employeeCode: "KM001", dateOfJoining: "2026-01-01" }];
  assert.equal(await getNextEmployeeCode("org-1", dbWithDates(rows), "EMPLOYEE", "Kerplunk Media", "2025-01-01"), "KM002");
});
