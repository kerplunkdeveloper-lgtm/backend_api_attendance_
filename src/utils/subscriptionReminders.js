/**
 * What to tell a company admin about their subscription, given where they are in its lifecycle.
 * Pure: no database, no clock of its own, so every rule is testable.
 *
 * Messages embed the end date, so each period produces its own distinct message and a reminder is never
 * sent twice for the same period (the sender skips messages the admin already has).
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const TRIAL_GRACE_DAYS = 7;
/** Reminder buckets, in days before the end. A job that missed a day still sends the right (smaller) bucket. */
const BUCKETS = [1, 3, 7];

const dayLabel = (days) => (days === 1 ? "1 day" : `${days} days`);
const dateLabel = (date) => date.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kolkata" });

const daysUntil = (end, now) => Math.ceil((end.getTime() - now.getTime()) / DAY_MS);
const bucketFor = (days) => BUCKETS.find((bucket) => days <= bucket) ?? null;

const planName = (plan) => {
  const text = String(plan || "").toLowerCase();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "paid";
};

/**
 * @param {{status?: string, plan?: string, expiresAt?: Date|string|null, trialEndsAt?: Date|string|null}} org
 * @returns {{key: string, title: string, message: string, urgent: boolean} | null}
 */
const reminderFor = (org, now = new Date()) => {
  const status = String(org.status || "").toUpperCase();
  const rawEnd = status === "TRIALING" ? org.trialEndsAt || org.expiresAt : org.expiresAt;
  if (!rawEnd) return null;
  const end = new Date(rawEnd);
  if (Number.isNaN(end.getTime())) return null;
  const days = daysUntil(end, now);
  const on = dateLabel(end);

  if (status === "TRIALING") {
    if (days > 0) {
      const bucket = bucketFor(days);
      if (!bucket) return null;
      return {
        key: `trial-${bucket}`,
        urgent: bucket <= 3,
        title: `Your free trial ends in ${dayLabel(days)}`,
        message: `Your WorkPulse trial ends on ${on}. Choose a plan before then to keep payroll, attendance and your team's data uninterrupted.`,
      };
    }
    if (days > -TRIAL_GRACE_DAYS) {
      const left = TRIAL_GRACE_DAYS + days;
      return {
        key: "trial-grace",
        urgent: true,
        title: "Your free trial has ended",
        message: `Your trial ended on ${on}. You have ${dayLabel(Math.max(1, left))} of grace left. Choose a plan now, or access will be locked.`,
      };
    }
    return {
      key: "trial-locked",
      urgent: true,
      title: "Your workspace is locked",
      message: `Your trial ended on ${on} and the grace period is over. Choose a plan to unlock your workspace. Your data is safe.`,
    };
  }

  if (status === "ACTIVE" || status === "CANCELED") {
    const canceled = status === "CANCELED";
    if (days > 0) {
      const bucket = bucketFor(days);
      if (!bucket) return null;
      return {
        key: `${canceled ? "canceled" : "renew"}-${bucket}`,
        urgent: bucket <= 3,
        title: canceled ? `Your ${planName(org.plan)} plan ends in ${dayLabel(days)}` : `Your ${planName(org.plan)} plan expires in ${dayLabel(days)}`,
        message: canceled
          ? `You canceled your ${planName(org.plan)} plan, which stays active until ${on}. Renew before then to keep access.`
          : `Your ${planName(org.plan)} plan expires on ${on}. Renew now so payroll and attendance are not interrupted.`,
      };
    }
    return {
      key: "paid-expired",
      urgent: true,
      title: `Your ${planName(org.plan)} plan has expired`,
      message: `Your plan expired on ${on}. Renew to restore full access.`,
    };
  }
  return null;
};

module.exports = { reminderFor, daysUntil, DAY_MS, TRIAL_GRACE_DAYS };
