const prisma = require("../config/database");
const { verifyAccessToken } = require("../utils/jwt");
const { getRedisSubscriber, publishRedis, logRedisError } = require("../config/redis");

const CHAT_CHANNEL = "workpulse:chat:messages";
const PRESENCE_CHANNEL = "workpulse:chat:presence";

function getWs() {
  try {
    // eslint-disable-next-line global-require
    return require("ws");
  } catch {
    return null;
  }
}

let wss = null;
let redisChatSubscriberStarted = false;
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

function onlineUserIds(organizationId) {
  const ids = [];
  for (const [userId, pool] of socketsByUser.entries()) {
    if ([...pool].some((ws) => ws.readyState === 1 && ws.organizationId === organizationId)) ids.push(userId);
  }
  return ids;
}

function broadcastPresenceLocal(event) {
  if (!event?.organizationId || !event.userId) return;
  const frame = JSON.stringify({ type: "chat:presence", userId: event.userId, online: Boolean(event.online) });
  for (const pool of socketsByUser.values()) {
    for (const ws of pool) {
      if (ws.readyState === 1 && ws.organizationId === event.organizationId) ws.send(frame);
    }
  }
}

function publishPresence(event) {
  publishRedis(PRESENCE_CHANNEL, event).then((published) => {
    if (!published) broadcastPresenceLocal(event);
  });
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
    const organizationId = ws.organizationId;
    if (pool) {
      pool.delete(ws);
      if (pool.size === 0) {
        socketsByUser.delete(userId);
        publishPresence({ organizationId, userId, online: false });
      }
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

  startRedisChatSubscriber();

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
    const wasOffline = !onlineUserIds(live.organizationId).includes(live.id);
    if (!socketsByUser.has(live.id)) socketsByUser.set(live.id, new Set());
    socketsByUser.get(live.id).add(ws);
    bindClient(ws, payload);
    ws.send(JSON.stringify({ type: "chat:presence:snapshot", userIds: onlineUserIds(live.organizationId) }));
    if (wasOffline) publishPresence({ organizationId: live.organizationId, userId: live.id, online: true });
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

async function startRedisChatSubscriber() {
  if (redisChatSubscriberStarted) return;
  redisChatSubscriberStarted = true;
  try {
    const subscriber = await getRedisSubscriber();
    if (!subscriber) return;
    await subscriber.subscribe(CHAT_CHANNEL, (raw) => {
      try {
        const event = JSON.parse(raw);
        broadcastLocalToThread(event.threadId, event.message);
      } catch (error) {
        logRedisError(error);
      }
    });
    await subscriber.subscribe(PRESENCE_CHANNEL, (raw) => {
      try { broadcastPresenceLocal(JSON.parse(raw)); } catch (error) { logRedisError(error); }
    });
  } catch (error) {
    redisChatSubscriberStarted = false;
    logRedisError(error);
  }
}

function broadcastLocalToThread(threadId, message) {
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

function broadcastToThread(threadId, message) {
  if (!threadId) return;
  // Publish once; every API replica, including this one, receives the event.
  // Without Redis, publishRedis returns false and we retain single-process
  // WebSocket behavior for local development.
  publishRedis(CHAT_CHANNEL, { threadId, message }).then((published) => {
    if (!published) broadcastLocalToThread(threadId, message);
  });
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
  broadcastLocalToThread,
  broadcastPresenceLocal,
  onlineUserIds,
  getSocketsByUser: () => socketsByUser,
  bindClient,
  canJoinThread,
  revokeUserSockets,
};
