const prisma = require("../config/database");
const fcm = require("./firebase-messaging.service");

// Save the inbox entry first. A push outage must not undo a saved decision.
async function deliver(rows) {
  try {
    await fcm.sendToUsers(rows.map((row) => ({ ...row, notificationId: row.id })));
  } catch (error) {
    console.warn("[NotificationDelivery] Push failed:", error.code || "delivery-error");
  }
}

async function create(args) {
  const row = await prisma.notification.create(args);
  await deliver([{ ...args.data, ...row }]);
  return row;
}

async function createMany(args) {
  const result = await prisma.notification.createMany(args);
  await deliver(Array.isArray(args.data) ? args.data : [args.data]);
  return result;
}

module.exports = { create, createMany };
