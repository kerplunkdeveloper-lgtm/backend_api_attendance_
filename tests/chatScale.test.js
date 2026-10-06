const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { mockPrisma, stubSideEffects, installModule } = require("./helpers/mockPrisma");

stubSideEffects();
installModule(require.resolve("../src/realtime/chatWs"), { broadcastToThread: () => {} });

const calls = { messages: null, users: null };
const prisma = {
  chatMember: { findFirst: async () => ({ id: "m1" }) },
  chatMessage: {
    findMany: async (args) => {
      calls.messages = args;
      // Newest-first, as the query asks for.
      return [{ id: "m3" }, { id: "m2" }, { id: "m1" }];
    },
    count: async () => 3,
  },
  user: {
    findMany: async (args) => {
      calls.users = args;
      return [];
    },
    count: async () => 0,
  },
};
mockPrisma(prisma);

const chat = require("../src/services/chat.service");

describe("chat at scale", () => {
  it("loads the NEWEST page of messages and returns it oldest-first", async () => {
    const result = await chat.getMessages("org", "u1", "t1", {});
    assert.deepEqual(calls.messages.orderBy, { createdAt: "desc" });
    assert.equal(calls.messages.take, 50);
    assert.deepEqual(result.records.map((m) => m.id), ["m1", "m2", "m3"]);
  });

  it("pages older history with a higher page number, capped at 200", async () => {
    await chat.getMessages("org", "u1", "t1", { page: 3, limit: 9999 });
    assert.equal(calls.messages.take, 200);
    assert.equal(calls.messages.skip, 400);
  });

  it("searches teammates on the server by name, email or code", async () => {
    await chat.listTeammates("org", "u1", { search: "  priya " });
    const or = calls.users.where.OR;
    assert.equal(or.length, 4);
    assert.equal(or[0].email.contains, "priya");
    assert.equal(calls.users.take, 30);
    assert.deepEqual(calls.users.where.id, { not: "u1" });
  });

  it("caps teammate page size", async () => {
    await chat.listTeammates("org", "u1", { limit: 5000 });
    assert.equal(calls.users.take, 100);
  });
});
