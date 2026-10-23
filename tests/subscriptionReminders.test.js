const test = require("node:test");
const assert = require("node:assert/strict");
const { reminderFor } = require("../src/utils/subscriptionReminders");

const NOW = new Date("2026-10-23T06:00:00Z");
const inDays = (n) => new Date(NOW.getTime() + n * 86400000);
const trial = (n) => reminderFor({ status: "TRIALING", trialEndsAt: inDays(n) }, NOW);

test("a trial warns at 7, 3 and 1 days, and stays quiet in between", () => {
  assert.equal(trial(14), null);
  assert.equal(trial(7).key, "trial-7");
  assert.equal(trial(6).key, "trial-7");
  assert.equal(trial(3).key, "trial-3");
  assert.equal(trial(2).key, "trial-3");
  assert.equal(trial(1).key, "trial-1");
});

test("a job that skipped a day still sends the nearest bucket", () => {
  assert.equal(trial(5).key, "trial-7");
  assert.equal(trial(0.4).key, "trial-1");
});

test("only the closing reminders are urgent, and titles read naturally", () => {
  assert.equal(trial(7).urgent, false);
  assert.equal(trial(3).urgent, true);
  assert.equal(trial(1).title, "Your free trial ends in 1 day");
  assert.equal(trial(3).title, "Your free trial ends in 3 days");
});

test("after the trial ends: grace period first, then locked", () => {
  const grace = trial(-2);
  assert.equal(grace.key, "trial-grace");
  assert.match(grace.message, /5 days of grace left/);
  assert.equal(trial(-7).key, "trial-locked");
  assert.equal(trial(-20).key, "trial-locked");
});

test("a paid plan warns before it expires and once after", () => {
  const paid = (n, status = "ACTIVE") => reminderFor({ status, plan: "PROFESSIONAL", expiresAt: inDays(n) }, NOW);
  assert.equal(paid(30), null);
  assert.equal(paid(7).key, "renew-7");
  assert.match(paid(7).title, /Professional plan expires in 7 days/);
  assert.equal(paid(-1).key, "paid-expired");
  assert.equal(paid(3, "CANCELED").key, "canceled-3");
  assert.match(paid(3, "CANCELED").message, /You canceled/);
});

test("each period has its own message, so a renewed plan is warned again next time", () => {
  const first = reminderFor({ status: "ACTIVE", plan: "STARTER", expiresAt: inDays(3) }, NOW);
  const nextYear = reminderFor({ status: "ACTIVE", plan: "STARTER", expiresAt: new Date(inDays(3).getTime() + 365 * 86400000) }, new Date(NOW.getTime() + 365 * 86400000));
  assert.notEqual(first.message, nextYear.message);
});

test("nothing to say without an end date, with a bad date, or for other statuses", () => {
  assert.equal(reminderFor({ status: "TRIALING" }, NOW), null);
  assert.equal(reminderFor({ status: "ACTIVE", expiresAt: "garbage" }, NOW), null);
  assert.equal(reminderFor({ status: "SUSPENDED", expiresAt: inDays(1) }, NOW), null);
});
