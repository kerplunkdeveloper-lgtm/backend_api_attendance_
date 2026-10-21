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
  assert.equal(await getNextEmployeeCode("org-1", db([]), "COMPANY_ADMIN", "WorkPluse"), "WP001");
});
