const prisma = require("../config/database");
const { verifyAccessToken } = require("../utils/jwt");

const tokenCache = new Map();

function getWs() {
  try {
    // eslint-disable-next-line global-require
    return require("ws");
  } catch {
    return null;
  }
}

let wss = null;
const socketsByUser = new Map();

async function assertLiveUser(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      isActive: true,
      organizationId: true,
      organization: { select: { deletedAt: true } },
    },
  });
  if (!user || user.isActive === false || user.organization?.deletedAt) {
    return null;
  }
  return user;
}

async function canJoinThread(userId, organizationId, threadId) {
  const member = await prisma.chatMember.findFirst({
    where: {
      threadId,
      userId,
      thread: { organizationId },
    },
    select: { id: true },
  });
  return Boolean(member);
}

function tokenExpired(payload) {
  if (!payload?.exp) return false;
  return Date.now() / 1000 >= payload.exp;
}

function bindClient(ws, payload) {
  const userId = payload.userId;
  ws.userId = userId;
  ws.organizationId = payload.organizationId || null;
  ws.tokenExp = payload.exp || null;
  ws.subscribedThreads = new Set();
  ws.isAlive = true;

  ws.on("pong", () => {
    ws.isAlive = true;
  });

  ws.on("message", async (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg?.type !== "subscribe" && msg?.type !== "unsubscribe") return;
      if (!msg.threadId) return;

      if (tokenExpired(payload) || !(await assertLiveUser(userId))) {
        ws.close(4001, "session expired");
        return;
      }

      if (msg.type === "unsubscribe") {
        ws.subscribedThreads.delete(msg.threadId);
        return;
      }

      const live = await assertLiveUser(userId);
      if (!live) {
        ws.close(4003, "account deactivated");
        return;
      }
      ws.organizationId = live.organizationId;

      const allowed = await canJoinThread(live.id, live.organizationId, msg.threadId);
      if (!allowed) {
        ws.send(JSON.stringify({ type: "error", error: "Not a member of this thread" }));
        return;
      }
      ws.subscribedThreads.add(msg.threadId);
    } catch {
      // ignore malformed frames
    }
  });

  ws.on("close", () => {
    const pool = socketsByUser.get(userId);
    if (pool) {
      pool.delete(ws);
      if (pool.size === 0) socketsByUser.delete(userId);
    }
  });
}

function attachChatWebSocket(server) {
  if (wss || !server) return;
  const Ws = getWs();
  if (!Ws) {
    console.warn("[chatWs] 'ws' package not installed; live chat disabled");
    return;
  }

  wss = new Ws.WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    let pathname;
    let token;
    try {
      const url = new URL(req.url, "http://127.0.0.1");
      pathname = url.pathname;
      token = url.searchParams.get("token");
    } catch {
      socket.destroy();
      return;
    }
    if (pathname !== "/ws/chat") {
      return;
    }
    if (!token) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    let payload;
    try {
      payload = verifyAccessToken(token);
    } catch {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req, payload);
    });
  });

  wss.on("connection", async (ws, req, payload) => {
    const live = await assertLiveUser(payload.userId);
    if (!live) {
      ws.close(4003, "account deactivated");
      return;
    }
    payload.organizationId = live.organizationId;
    if (!socketsByUser.has(live.id)) socketsByUser.set(live.id, new Set());
    socketsByUser.get(live.id).add(ws);
    bindClient(ws, payload);
  });

  const heartbeat = setInterval(async () => {
    for (const pool of socketsByUser.values()) {
      for (const ws of pool) {
        if (ws.isAlive === false || tokenExpired({ exp: ws.tokenExp })) {
          ws.terminate();
          continue;
        }
        const live = await assertLiveUser(ws.userId);
        if (!live) {
          ws.terminate();
          continue;
        }
        ws.organizationId = live.organizationId;
        if (ws.subscribedThreads?.size) {
          for (const threadId of [...ws.subscribedThreads]) {
            const allowed = await canJoinThread(live.id, live.organizationId, threadId);
            if (!allowed) ws.subscribedThreads.delete(threadId);
          }
        }
        ws.isAlive = false;
        ws.ping();
      }
    }
  }, 30_000);
  heartbeat.unref?.();
}

function broadcastToThread(threadId, message) {
  if (!wss || !threadId) return;
  const orgId = message?.organizationId;
  const frame = JSON.stringify({ type: "chat:message", message });
  for (const pool of socketsByUser.values()) {
    for (const ws of pool) {
      if (ws.readyState !== 1) continue;
      if (!ws.subscribedThreads?.has(threadId)) continue;
      if (orgId && ws.organizationId && ws.organizationId !== orgId) continue;
      ws.send(frame);
    }
  }
}

function revokeUserSockets(userId) {
  const pool = socketsByUser.get(userId);
  if (!pool) return;
  for (const ws of pool) {
    try {
      ws.close(4003, "account deactivated");
    } catch {
      ws.terminate();
    }
  }
}

module.exports = {
  attachChatWebSocket,
  broadcastToThread,
  getSocketsByUser: () => socketsByUser,
  bindClient,
  canJoinThread,
  revokeUserSockets,
};
