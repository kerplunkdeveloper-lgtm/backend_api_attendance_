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

function attachChatWebSocket(server) {
  if (wss || !server) return;
  const Ws = getWs();
  if (!Ws) {
    console.warn("[chatWs] 'ws' package not installed; live chat disabled");
    return;
  }

  const { verifyAccessToken } = require("../utils/jwt");

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
      // Not a chat upgrade; let other handlers (if any) deal with it.
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

  wss.on("connection", (ws, req, payload) => {
    const userId = payload.userId;
    ws.subscribedThreads = new Set();

    if (!socketsByUser.has(userId)) socketsByUser.set(userId, new Set());
    socketsByUser.get(userId).add(ws);

    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg?.type === "subscribe" && msg.threadId) {
          ws.subscribedThreads.add(msg.threadId);
        } else if (msg?.type === "unsubscribe" && msg.threadId) {
          ws.subscribedThreads.delete(msg.threadId);
        }
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
  });

  // Heartbeat to drop dead connections and keep the pool honest.
  const heartbeat = setInterval(() => {
    for (const pool of socketsByUser.values()) {
      for (const ws of pool) {
        if (ws.isAlive === false) {
          ws.terminate();
          continue;
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
  const frame = JSON.stringify({ type: "chat:message", message });
  for (const pool of socketsByUser.values()) {
    for (const ws of pool) {
      if (ws.readyState === 1 && ws.subscribedThreads?.has(threadId)) {
        ws.send(frame);
      }
    }
  }
}

module.exports = {
  attachChatWebSocket,
  broadcastToThread,
  getSocketsByUser: () => socketsByUser,
};
