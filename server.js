require("dotenv").config();

const app = require("./src/app");
const prisma = require("./src/config/database");
const notificationService = require("./src/services/notification.service");

/**
 * The reminder / absent-marking scheduler runs on an interval inside this
 * process. With more than one replica every instance fires it independently,
 * producing duplicate reminders and duplicate absent marking, so it is opt-in:
 * enable it on exactly one instance, or run a dedicated worker.
 *
 * Defaults to on outside production to keep local development unchanged.
 */
function startBackgroundScheduler() {
  const flag = process.env.ENABLE_SCHEDULER;
  const enabled = flag === undefined ? process.env.NODE_ENV !== "production" : flag === "true";

  if (!enabled) {
    console.log("[scheduler] disabled (set ENABLE_SCHEDULER=true on one instance to enable)");
    return;
  }

  try {
    notificationService.startScheduler();
    console.log("[scheduler] background reminders started");
  } catch (err) {
    console.error("Failed to start notification scheduler:", err.message);
  }
}

let server;

/**
 * Attach the live-chat WebSocket gateway on this process's listening server.
 * Opt-in (ENABLE_WEBSOCKETS=true) so platform quirks never affect HTTP traffic.
 */
function startChatGateway(srv) {
  if ((process.env.ENABLE_WEBSOCKETS || "").trim().toLowerCase() !== "true") {
    console.log("[chatWs] live chat disabled (set ENABLE_WEBSOCKETS=true to enable)");
    return;
  }
  try {
    const { attachChatWebSocket } = require("./src/realtime/chatWs");
    attachChatWebSocket(srv);
    console.log("[chatWs] live chat WebSocket gateway attached");
  } catch (err) {
    console.error("Failed to attach chat WebSocket gateway:", err.message);
  }
}

// Support Phusion Passenger (used by Hostinger / cPanel shared hosting)
if (typeof PhusionPassenger !== "undefined") {
  PhusionPassenger.configure({ autoInstall: false });
  server = app.listen("passenger", () => {
    console.log("Server running via Phusion Passenger on Hostinger");
    startBackgroundScheduler();
    startChatGateway(server);
  });
} else {
  const PORT = process.env.PORT || 5000;
  const HOST = process.env.HOST || "0.0.0.0";
  server = app.listen(PORT, HOST, () => {
    console.log(`Server running on http://${HOST}:${PORT}`);
    startBackgroundScheduler();
    startChatGateway(server);
  });
}

/**
 * Close connections on shutdown so in-flight requests finish and the database
 * pool is released instead of being torn down mid-query by the platform.
 */
const shutdown = async (signal) => {
  console.log(`[${signal}] shutting down`);
  const forceExit = setTimeout(() => process.exit(1), 10_000);
  forceExit.unref();

  server?.close(async () => {
    try {
      await prisma.$disconnect();
    } catch (err) {
      console.error("Error disconnecting Prisma:", err.message);
    }
    process.exit(0);
  });
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled promise rejection:", reason);
});
