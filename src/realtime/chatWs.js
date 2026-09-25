const prisma = require("../config/database");
const { verifyAccessToken } = require("../utils/jwt");
const { assertEntitled } = require("../services/entitlement.service");
const socketsByUser = new Map();
let wss;
async function activeUser(token) {
  const payload = verifyAccessToken(token);
  if (!payload.userId) throw new Error("Invalid token");
  const user = await prisma.user.findUnique({ where: { id: payload.userId }, include: { organization: { include: { subscription: true } }, employee: true } });
  if (!user || user.isActive === false || user.employee?.deletedAt || ["INACTIVE", "TERMINATED"].includes(user.employee?.status) || user.organization?.deletedAt) throw new Error("Inactive account");
  assertEntitled(user.organization);
  return { user, payload };
}
async function mayRead(ws, threadId) {
  const { user } = await activeUser(ws.accessToken);
  if (user.id !== ws.userId) return false;
  return Boolean(await prisma.chatMember.findFirst({ where: { userId: user.id, threadId, thread: { organizationId: user.organizationId } }, select: { id: true } }));
}
function attachChatWebSocket(server) {
  if (wss || !server) return;
  const { WebSocketServer } = require("ws");
  wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });
  server.on("upgrade", async (request, socket, head) => {
    let url;
    try { url = new URL(request.url, "http://localhost"); } catch { socket.destroy(); return; }
    if (url.pathname !== "/ws/chat") return;
    try {
      const token = url.searchParams.get("token");
      if (!token) throw new Error("Missing token");
      const { user, payload } = await activeUser(token);
      if (socket.destroyed) return;
      wss.handleUpgrade(request, socket, head, ws => {
        ws.accessToken = token;
        ws.userId = user.id;
        ws.isAlive = true;
        ws.subscribedThreads = new Set();
        ws.pendingSubscriptions = new Set();
        ws.expiryTimer = setTimeout(() => ws.close(1008, "Session expired"), Math.max(0, payload.exp * 1000 - Date.now()));
        ws.expiryTimer.unref?.();
        if (!socketsByUser.has(user.id)) socketsByUser.set(user.id, new Set());
        socketsByUser.get(user.id).add(ws);
        ws.on("pong", () => { ws.isAlive = true; });
        ws.on("error", () => ws.terminate());
        ws.on("message", async raw => {
          let msg;
          try { msg = JSON.parse(raw.toString()); } catch { ws.close(1008, "Invalid message"); return; }
          if (typeof msg.threadId !== "string" || msg.threadId.length > 100) return;
          if (msg.type === "unsubscribe") {
            ws.subscribedThreads.delete(msg.threadId);
            ws.pendingSubscriptions.delete(msg.threadId);
            return;
          }
          if (msg.type !== "subscribe" || ws.subscribedThreads.has(msg.threadId) || ws.pendingSubscriptions.has(msg.threadId)) return;
          if (ws.subscribedThreads.size + ws.pendingSubscriptions.size >= 50) { ws.close(1008, "Subscription limit reached"); return; }
          ws.pendingSubscriptions.add(msg.threadId);
          try {
            const allowed = await mayRead(ws, msg.threadId);
            if (ws.readyState !== 1 || !ws.pendingSubscriptions.has(msg.threadId)) return;
            if (!allowed) { ws.send(JSON.stringify({ type: "error", message: "Thread access denied" })); return; }
            ws.subscribedThreads.add(msg.threadId);
            ws.send(JSON.stringify({ type: "subscribed", threadId: msg.threadId }));
          } catch { ws.close(1008, "Access denied"); }
          finally { ws.pendingSubscriptions.delete(msg.threadId); }
        });
        ws.on("close", () => {
          clearTimeout(ws.expiryTimer);
          const pool = socketsByUser.get(user.id);
          pool?.delete(ws);
          if (pool?.size === 0) socketsByUser.delete(user.id);
        });
      });
    } catch {
      if (!socket.destroyed) { socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n"); socket.destroy(); }
    }
  });
  const heartbeat = setInterval(() => {
    for (const pool of socketsByUser.values()) for (const ws of pool) {
      if (ws.isAlive === false) { ws.terminate(); continue; }
      ws.isAlive = false;
      ws.ping();
    }
  }, 30000);
  heartbeat.unref?.();
  server.on("close", () => {
    clearInterval(heartbeat);
    for (const pool of socketsByUser.values()) for (const ws of pool) ws.terminate();
    wss.close(); wss = null;
  });
}
async function broadcastToThread(threadId, message) {
  if (!wss || !threadId) return;
  const jobs = [];
  for (const pool of socketsByUser.values()) for (const ws of pool) {
    if (ws.readyState !== 1 || !ws.subscribedThreads.has(threadId)) continue;
    jobs.push((async () => {
      try {
        if (!await mayRead(ws, threadId)) { ws.subscribedThreads.delete(threadId); return; }
        if (ws.readyState === 1 && ws.subscribedThreads.has(threadId)) ws.send(JSON.stringify({ type: "chat:message", message }));
      } catch { ws.close(1008, "Access denied"); }
    })());
  }
  await Promise.allSettled(jobs);
}
module.exports = { attachChatWebSocket, broadcastToThread, getSocketsByUser: () => socketsByUser };
