/**
 * Employment statuses that are still working for the company: they punch in, take leave,
 * are paid and occupy a billing seat. Offboarding moves a resigning employee to
 * NOTICE_PERIOD, so filtering on "ACTIVE" alone silently drops them from payroll,
 * attendance boards, reports and reminders for their last weeks.
 */
const WORKING_STATUSES = ["ACTIVE", "PROBATION", "NOTICE_PERIOD"];

/** Prisma `where` fragment: `where: { organizationId, ...workingStaff }`. */
const workingStaff = { status: { in: WORKING_STATUSES } };

module.exports = { WORKING_STATUSES, workingStaff };
