const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { mockPrisma, stubSideEffects } = require("./helpers/mockPrisma");

stubSideEffects();
mockPrisma({});

const router = require("../src/routes/chat.routes");

/** The middleware chain registered for POST /groups, minus authenticate and the final handler. */
const groupGuards = () => {
  const layer = router.stack.find((l) => l.route?.path === "/groups" && l.route.methods.post);
  return layer.route.stack.map((s) => s.handle);
};

const run = (role) => {
  const [guard] = groupGuards();
  const res = { statusCode: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  let passed = false;
  guard({ user: { role } }, res, () => { passed = true; });
  return { passed, res };
};

describe("creating a chat channel", () => {
  it("is allowed for admins and HR", () => {
    for (const role of ["SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"]) {
      assert.equal(run(role).passed, true, role);
    }
  });

  it("is refused with 403 for employees", () => {
    const { passed, res } = run("EMPLOYEE");
    assert.equal(passed, false);
    assert.equal(res.statusCode, 403);
  });

  it("does not stop anyone from direct messages or reading threads", () => {
    const open = router.stack.find((l) => l.route?.path === "/threads" && l.route.methods.post);
    assert.equal(open.route.stack.length, 1, "direct messages have only the handler, no role guard");
  });
});
