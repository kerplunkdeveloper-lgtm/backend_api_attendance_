const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { assertCanReview, visibleToReviewer } = require("../src/utils/approvalChain");

describe("approval chain", () => {
  it("lets HR or an admin approve an employee's request", () => {
    assert.doesNotThrow(() => assertCanReview("EMPLOYEE", "MANAGER"));
    assert.doesNotThrow(() => assertCanReview("EMPLOYEE", "COMPANY_ADMIN"));
  });

  it("requires an admin for requests raised by HR or admins", () => {
    assert.throws(() => assertCanReview("MANAGER", "MANAGER"), (e) => e.statusCode === 403);
    assert.throws(() => assertCanReview("COMPANY_ADMIN", "MANAGER"), (e) => e.statusCode === 403);
    assert.doesNotThrow(() => assertCanReview("MANAGER", "COMPANY_ADMIN"));
    assert.doesNotThrow(() => assertCanReview("MANAGER", "SUPER_ADMIN"));
  });

  it("hides HR/admin requests from HR reviewers but not from admins", () => {
    assert.deepEqual(visibleToReviewer("COMPANY_ADMIN"), {});
    assert.deepEqual(visibleToReviewer("MANAGER"), { employee: { user: { is: { role: "EMPLOYEE" } } } });
  });
});
