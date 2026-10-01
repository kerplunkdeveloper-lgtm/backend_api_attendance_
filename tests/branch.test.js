const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { mockPrisma } = require("./helpers/mockPrisma");

mockPrisma({
  branch: {
    findMany: async ({ where }) => [
      { id: "branch-1", organizationId: where.organizationId, name: "Head Office" },
    ],
  },
});

const branchService = require("../src/services/branch.service");

describe("branches", () => {
  it("lists branches for the authenticated organization", async () => {
    const branches = await branchService.getBranches("org-1");

    assert.equal(branches.length, 1);
    assert.equal(branches[0].organizationId, "org-1");
  });
});
