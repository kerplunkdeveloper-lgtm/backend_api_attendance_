const { cert, getApps, initializeApp } = require("firebase-admin/app");
const { getMessaging } = require("firebase-admin/messaging");
const prisma = require("../config/database");

let messaging = null;
let initializationError = null;

try {
  const app = getApps()[0] || (() => {
    const serviceAccountJson = String(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || "").trim();
    if (serviceAccountJson) {
      return initializeApp({ credential: cert(JSON.parse(serviceAccountJson)) });
    }
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.GOOGLE_CLOUD_PROJECT || process.env.K_SERVICE) return initializeApp();
    throw new Error("Set FIREBASE_SERVICE_ACCOUNT_JSON or configure Google Application Default Credentials.");
  })();
  messaging = getMessaging(app);
} catch (error) {
  initializationError = error;
  console.warn("[FCM] Firebase Admin is not configured:", error.message);
}

const configured = Boolean(messaging);
const isInvalidTokenError = (error) => [
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
].includes(error?.code);

const sendToUser = async ({ userId, title, message, notificationId, type }) => {
  if (!configured || !userId) return 0;
  const rows = await prisma.fcmToken.findMany({ where: { userId }, select: { id: true, token: true } });
  if (!rows.length) return 0;

  const response = await messaging.sendEachForMulticast({
    tokens: rows.map((row) => row.token),
    notification: { title: title || "WorkPluse notification", body: message || "You have a new notification." },
    data: { notificationId: String(notificationId || ""), type: String(type || "SYSTEM"), url: "/dashboard" },
    webpush: {
      fcmOptions: {
        link: new URL("/dashboard", process.env.FRONTEND_URL || "http://localhost:3000").toString(),
      },
    },
  });

  let sent = 0;
  const invalidIds = [];
  response.responses.forEach((result, index) => {
    if (result.success) sent += 1;
    else if (isInvalidTokenError(result.error)) invalidIds.push(rows[index].id);
    else console.warn("[FCM] Delivery failed:", result.error?.message || "Unknown FCM error");
  });
  if (invalidIds.length) await prisma.fcmToken.deleteMany({ where: { id: { in: invalidIds } } }).catch(() => {});
  return sent;
};

const sendToUsers = async (rows) => {
  if (!configured || !rows?.length) return 0;
  const results = await Promise.all(rows.map((row) => sendToUser(row).catch((error) => {
    console.warn("[FCM] User delivery failed:", error.message);
    return 0;
  })));
  return results.reduce((total, count) => total + count, 0);
};

module.exports = { provider: "FCM", configured, initializationError, sendToUser, sendToUsers };
