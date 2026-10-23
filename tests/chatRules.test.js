const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { mockPrisma } = require("./helpers/mockPrisma");

let userWhere;
mockPrisma({
  user: {
    findFirst: async ({ where }) => {
      userWhere = where;
      return where.isActive ? { id: where.id } : { id: where.id };
    },
    findMany: async ({ where }) => {
      userWhere = where;
      return [{ id: "me" }, { id: "u2" }];
    },
  },
  chatThread: { findFirst: async () => null, create: async ({ data }) => data },
});
require.cache[require.resolve("../src/realtime/chatWs")] = { id: "x", filename: "x", loaded: true, exports: { broadcastToThread: () => {} } };

const chat = require("../src/services/chat.service");

describe("chat rules", () => {
  it("only opens a direct chat with an active teammate", async () => {
    await chat.openDirect("org-1", "me", "u2");
    assert.equal(userWhere.isActive, true);
    assert.equal(userWhere.organizationId, "org-1");
  });

  it("only adds active people from the same organization to a group", async () => {
    await chat.createGroup("org-1", "me", { title: "Design", userIds: ["u2"] });
    assert.equal(userWhere.isActive, true);
    assert.equal(userWhere.organizationId, "org-1");
  });

  it("rejects an oversized title or a huge member list", async () => {
    await assert.rejects(chat.createGroup("org-1", "me", { title: "x".repeat(81), userIds: ["u2"] }), (e) => e.statusCode === 400);
    const many = Array.from({ length: 250 }, (_, i) => `u${i}`);
    await assert.rejects(chat.createGroup("org-1", "me", { title: "Everyone", userIds: many }), /at most 200/);
  });

  it("ignores non-string ids in the member list", async () => {
    await chat.createGroup("org-1", "me", { title: "Ops", userIds: [{ $ne: null }, "u2", 7] });
    assert.deepEqual([...userWhere.id.in].sort(), ["me", "u2"]);
  });
});
