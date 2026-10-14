const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("events");
const { mockPrisma } = require("./helpers/mockPrisma");

mockPrisma({
  user: {
    findUnique: async () => ({ id: "user-a", isActive: true, organizationId: "org-a", organization: { deletedAt: null } }),
  },
  chatMember: {
    findFirst: async ({ where }) => {
      if (where.threadId === "thread-b" && where.userId === "user-a") return null;
      if (where.threadId === "thread-a") return { id: "mem-1" };
      return null;
    },
  },
});

const { bindClient, canJoinThread, getSocketsByUser, onlineUserIds, broadcastPresenceLocal } = require("../src/realtime/chatWs");

describe("chat websocket", () => {
  it("registers a pong handler that marks the socket alive", () => {
    const ws = new EventEmitter();
    bindClient(ws, { userId: "user-a", organizationId: "org-a", exp: Math.floor(Date.now() / 1000) + 60 });
    assert.equal(ws.listenerCount("pong"), 1);
    ws.isAlive = false;
    ws.emit("pong");
    assert.equal(ws.isAlive, true);
  });

  it("refuses a foreign-tenant thread subscription", async () => {
    const allowed = await canJoinThread("user-a", "org-a", "thread-b");
    assert.equal(allowed, false);
    const home = await canJoinThread("user-a", "org-a", "thread-a");
    assert.equal(home, true);
  });

  it("does not add unauthorized thread ids from a subscribe frame", async () => {
    const ws = new EventEmitter();
    const sent = [];
    ws.send = (frame) => sent.push(JSON.parse(frame));
    bindClient(ws, { userId: "user-a", organizationId: "org-a", exp: Math.floor(Date.now() / 1000) + 60 });
    await new Promise((resolve) => {
      ws.send = (frame) => {
        sent.push(JSON.parse(frame));
        resolve();
      };
      ws.emit("message", Buffer.from(JSON.stringify({ type: "subscribe", threadId: "thread-b" })));
      setTimeout(resolve, 100);
    });
    assert.equal(ws.subscribedThreads.has("thread-b"), false);
    assert.equal(sent[0]?.error, "Not a member of this thread");
  });

  it("keeps presence tenant-scoped and broadcasts only to the same organization", () => {
    const home = { readyState: 1, organizationId: "org-a", send: (frame) => home.frames.push(JSON.parse(frame)), frames: [] };
    const foreign = { readyState: 1, organizationId: "org-b", send: (frame) => foreign.frames.push(JSON.parse(frame)), frames: [] };
    getSocketsByUser().set("user-a", new Set([home]));
    getSocketsByUser().set("user-b", new Set([foreign]));
    assert.deepEqual(onlineUserIds("org-a"), ["user-a"]);
    broadcastPresenceLocal({ organizationId: "org-a", userId: "user-c", online: true });
    assert.equal(home.frames[0].type, "chat:presence");
    assert.equal(home.frames[0].userId, "user-c");
    assert.equal(foreign.frames.length, 0);
    getSocketsByUser().clear();
  });
});
