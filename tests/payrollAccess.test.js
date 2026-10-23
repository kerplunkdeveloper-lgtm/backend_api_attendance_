const test = require("node:test");
const assert = require("node:assert/strict");
const { assertCanSetStatus, assertNotOwnSalary } = require("../src/utils/payrollAccess");

const code = (fn) => {
  try {
    fn();
    return null;
  } catch (e) {
    return e.statusCode;
  }
};

test("HR can submit payroll for approval but cannot approve, reject or disburse it", () => {
  assert.equal(code(() => assertCanSetStatus("MANAGER", "PENDING_APPROVAL")), null);
  assert.equal(code(() => assertCanSetStatus("MANAGER", "DRAFT")), null);
  for (const status of ["APPROVED", "REJECTED", "DISBURSED"]) assert.equal(code(() => assertCanSetStatus("MANAGER", status)), 403, status);
});

test("an admin can make any status change", () => {
  for (const status of ["APPROVED", "REJECTED", "DISBURSED", "DRAFT"]) {
    assert.equal(code(() => assertCanSetStatus("COMPANY_ADMIN", status)), null, status);
  }
});

test("HR cannot change their own salary, alone or inside a bulk update", async () => {
  const findOwn = async (ids) => ids.includes("me");
  await assert.rejects(assertNotOwnSalary({ role: "MANAGER", employeeIds: ["me"], findOwn }), (e) => e.statusCode === 403);
  await assert.rejects(assertNotOwnSalary({ role: "MANAGER", employeeIds: ["a", "me", "b"], findOwn }), (e) => e.statusCode === 403);
  await assertNotOwnSalary({ role: "MANAGER", employeeIds: ["a", "b"], findOwn });
});

test("admins are not blocked, and an empty list never queries", async () => {
  let called = 0;
  const findOwn = async () => {
    called += 1;
    return true;
  };
  await assertNotOwnSalary({ role: "COMPANY_ADMIN", employeeIds: ["me"], findOwn });
  await assertNotOwnSalary({ role: "MANAGER", employeeIds: [], findOwn });
  await assertNotOwnSalary({ role: "MANAGER", employeeIds: [null, ""], findOwn });
  assert.equal(called, 0);
});
