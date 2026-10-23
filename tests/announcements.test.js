const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { mockPrisma } = require("./helpers/mockPrisma");

let rows;
let notifications;
let failNotify = false;
let lastListWhere;

mockPrisma({
  announcement: {
    findMany: async ({ where }) => {
      lastListWhere = where;
      const now = new Date();
      return rows.filter((r) => r.organizationId === where.organizationId && (!where.OR || !r.expiresAt || r.expiresAt > now));
    },
    findFirst: async ({ where }) => rows.find((r) => r.id === where.id && r.organizationId === where.organizationId) || null,
    create: async ({ data }) => {
      const row = { id: `a${rows.length + 1}`, createdAt: new Date(), ...data };
      rows.push(row);
      return row;
    },
    update: async ({ where, data }) => Object.assign(rows.find((r) => r.id === where.id), data),
    delete: async ({ where }) => {
      rows = rows.filter((r) => r.id !== where.id);
    },
  },
  user: {
    findMany: async ({ where }) => {
      assert.deepEqual(where.employee, { is: { status: { in: ["ACTIVE", "PROBATION", "NOTICE_PERIOD"] } } });
      return [{ id: "u-emp1" }, { id: "u-emp2" }];
    },
  },
  notification: {
    createMany: async ({ data }) => {
      if (failNotify) throw new Error("db down");
      notifications.push(...data);
      return { count: data.length };
    },
  },
});

const announcements = require("../src/services/announcement.service");

const admin = { id: "u-admin", role: "COMPANY_ADMIN" };
const hr = { id: "u-hr", role: "MANAGER" };
const worker = { id: "u-emp1", role: "EMPLOYEE" };
const future = new Date(Date.now() + 86400000).toISOString();

beforeEach(() => {
  rows = [];
  notifications = [];
  failNotify = false;
});

describe("posting announcements", () => {
  it("lets HR post, and notifies everyone still working except the author", async () => {
    const result = await announcements.create("org-1", hr, { title: "Diwali holiday", body: "Office closed 31 Oct." });
    assert.equal(result.notified, 2);
    assert.deepEqual(notifications.map((n) => n.userId), ["u-emp1", "u-emp2"]);
    assert.equal(notifications[0].type, "ANNOUNCEMENT");
    assert.equal(rows[0].createdByUserId, "u-hr");
  });

  it("refuses an ordinary employee", async () => {
    await assert.rejects(announcements.create("org-1", worker, { title: "x", body: "y" }), (e) => e.statusCode === 403);
  });

  it("validates title, message and expiry", async () => {
    await assert.rejects(announcements.create("org-1", admin, { title: "  ", body: "ok" }), /Title is required/);
    await assert.rejects(announcements.create("org-1", admin, { title: "ok", body: "x".repeat(2001) }), /2000 characters/);
    await assert.rejects(announcements.create("org-1", admin, { title: "ok", body: "ok", expiresAt: "2020-01-01" }), /future/);
    await assert.rejects(announcements.create("org-1", admin, { title: "ok", body: "ok", expiresAt: "nope" }), /valid expiry/);
  });

  it("still saves the post when notifications fail, and can skip them on request", async () => {
    failNotify = true;
    const result = await announcements.create("org-1", admin, { title: "Policy", body: "Updated.", expiresAt: future });
    assert.equal(result.notified, 0);
    assert.equal(rows.length, 1);
    const quiet = await announcements.create("org-1", admin, { title: "Quiet", body: "No ping", notify: false });
    assert.equal(quiet.notified, 0);
  });
});

describe("reading announcements", () => {
  it("hides expired posts from employees but shows them to HR with a flag", async () => {
    rows = [
      { id: "live", organizationId: "org-1", title: "Live", expiresAt: null },
      { id: "old", organizationId: "org-1", title: "Old", expiresAt: new Date(Date.now() - 1000) },
      { id: "other", organizationId: "org-2", title: "Other tenant", expiresAt: null },
    ];
    const asWorker = await announcements.list("org-1", worker);
    assert.deepEqual(asWorker.map((r) => r.id), ["live"]);
    const asHr = await announcements.list("org-1", hr);
    assert.deepEqual(asHr.map((r) => [r.id, r.isExpired]), [["live", false], ["old", true]]);
    assert.equal(lastListWhere.OR, undefined);
  });
});

describe("changing announcements", () => {
  beforeEach(() => {
    rows = [
      { id: "mine", organizationId: "org-1", title: "Mine", body: "b", createdByUserId: "u-hr" },
      { id: "theirs", organizationId: "org-1", title: "Theirs", body: "b", createdByUserId: "u-admin" },
    ];
  });

  it("lets HR edit and delete only their own posts", async () => {
    const edited = await announcements.update("org-1", hr, "mine", { pinned: true });
    assert.equal(edited.pinned, true);
    await assert.rejects(announcements.update("org-1", hr, "theirs", { pinned: true }), (e) => e.statusCode === 403);
    await assert.rejects(announcements.remove("org-1", hr, "theirs"), (e) => e.statusCode === 403);
    await announcements.remove("org-1", hr, "mine");
    assert.deepEqual(rows.map((r) => r.id), ["theirs"]);
  });

  it("lets an admin change anyone's post, and clears expiry with null", async () => {
    rows[1].expiresAt = new Date(Date.now() + 1000);
    const updated = await announcements.update("org-1", admin, "theirs", { expiresAt: null });
    assert.equal(updated.expiresAt, null);
  });

  it("returns 404 for a post in another organization", async () => {
    await assert.rejects(announcements.remove("org-2", admin, "mine"), (e) => e.statusCode === 404);
  });
});
