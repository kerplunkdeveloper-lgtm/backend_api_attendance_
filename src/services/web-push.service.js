const webpush = require("web-push");
const prisma = require("../config/database");

const publicKey = String(process.env.VAPID_PUBLIC_KEY || "").trim();
const privateKey = String(process.env.VAPID_PRIVATE_KEY || "").trim();
const subject = String(process.env.VAPID_SUBJECT || "mailto:admin@workpulse.in").trim();
const configured = Boolean(publicKey && privateKey);

if (configured) {
  webpush.setVapidDetails(subject, publicKey, privateKey);
}

const sendToUser = async ({ userId, title, message, notificationId, type }) => {
  if (!configured || !userId) return 0;

  const subscriptions = await prisma.pushSubscription.findMany({
    where: { userId },
    select: { id: true, endpoint: true, p256dh: true, auth: true },
  });
  if (!subscriptions.length) return 0;

  const payload = JSON.stringify({
    title: title || "WorkPluse notification",
    body: message || "You have a new notification.",
    notificationId: notificationId || null,
    type: type || "SYSTEM",
    url: "/dashboard",
  });
  let sent = 0;

  await Promise.all(subscriptions.map(async (row) => {
    try {
      await webpush.sendNotification({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } }, payload);
      sent += 1;
    } catch (error) {
      if (error.statusCode === 404 || error.statusCode === 410) {
        await prisma.pushSubscription.deleteMany({ where: { id: row.id } }).catch(() => {});
      } else {
        console.warn("[WebPush] Delivery failed:", error.message);
      }
    }
  }));
  return sent;
};

const sendToUsers = async (rows) => {
  if (!configured || !rows?.length) return 0;
  const results = await Promise.all(rows.map((row) => sendToUser(row).catch((error) => {
    console.warn("[WebPush] User delivery failed:", error.message);
    return 0;
  })));
  return results.reduce((total, count) => total + count, 0);
};

module.exports = { configured, publicKey, sendToUser, sendToUsers };
