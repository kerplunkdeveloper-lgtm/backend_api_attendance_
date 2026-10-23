const prisma = require("../config/database");
const emailService = require("./email.service");
const { reminderFor, DAY_MS } = require("../utils/subscriptionReminders");

const LOOK_BACK_DAYS = 14;
const LOOK_AHEAD_DAYS = 8;
const MAX_ORGS = 500;

/**
 * Warns company admins before a trial or plan ends, and once when it has. Safe to run as often as you like:
 * a reminder carries its end date, so an admin who already has that message is skipped.
 */
async function sendSubscriptionReminders(now = new Date()) {
  const from = new Date(now.getTime() - LOOK_BACK_DAYS * DAY_MS);
  const to = new Date(now.getTime() + LOOK_AHEAD_DAYS * DAY_MS);
  const inWindow = { gte: from, lte: to };

  const orgs = await prisma.organization.findMany({
    where: { OR: [{ subscriptionExpiresAt: inWindow }, { trialEndsAt: inWindow }, { subscription: { is: { currentPeriodEnd: inWindow } } }] },
    select: {
      id: true,
      name: true,
      logoUrl: true,
      subscriptionPlan: true,
      subscriptionStatus: true,
      subscriptionExpiresAt: true,
      trialEndsAt: true,
      subscription: { select: { status: true, plan: true, currentPeriodEnd: true } },
    },
    take: MAX_ORGS,
  });

  let reminded = 0;
  for (const org of orgs) {
    // Same precedence the access check uses, so the warning matches what will actually happen.
    const reminder = reminderFor(
      {
        status: org.subscription?.status || org.subscriptionStatus,
        plan: org.subscription?.plan || org.subscriptionPlan,
        expiresAt: org.subscription?.currentPeriodEnd || org.subscriptionExpiresAt,
        trialEndsAt: org.trialEndsAt,
      },
      now,
    );
    if (!reminder) continue;

    const admins = await prisma.user.findMany({
      where: { organizationId: org.id, role: "COMPANY_ADMIN", isActive: true },
      select: { id: true, email: true },
    });
    if (!admins.length) continue;

    const already = await prisma.notification.findMany({
      where: { organizationId: org.id, type: "BILLING", userId: { in: admins.map((a) => a.id) }, createdAt: { gte: new Date(now.getTime() - 40 * DAY_MS) } },
      select: { userId: true, message: true },
    });
    const seen = new Set(already.map((n) => `${n.userId}|${n.message}`));
    const fresh = admins.filter((admin) => !seen.has(`${admin.id}|${reminder.message}`));
    if (!fresh.length) continue;

    await prisma.notification.createMany({
      data: fresh.map((admin) => ({
        organizationId: org.id,
        userId: admin.id,
        title: reminder.title,
        message: reminder.message,
        type: "BILLING",
      })),
    });
    reminded += fresh.length;

    // Email is best effort: the in-app notice is already saved, and a mail outage must not stop the sweep.
    for (const admin of fresh) {
      try {
        await emailService.sendSubscriptionReminderEmail(admin.email, {
          companyName: org.name,
          companyLogoUrl: org.logoUrl,
          title: reminder.title,
          message: reminder.message,
          urgent: reminder.urgent,
        });
      } catch (error) {
        console.warn(`[SubscriptionReminder] Email to ${admin.email} failed:`, error.message);
      }
    }
  }
  return { organizations: orgs.length, reminded };
}

module.exports = { sendSubscriptionReminders };
