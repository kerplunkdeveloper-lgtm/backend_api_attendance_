/**
 * The main working day, end to end over real HTTP against the real app and a real database:
 *
 *   register a company -> admin logs in -> employee logs in -> punches in and out
 *   -> asks for a correction -> HR approves it -> the attendance row changes
 *   -> a second company cannot see or touch any of it.
 *
 * It writes rows, so it is skipped unless a disposable database is given:
 *
 *   TEST_DATABASE_URL=postgresql://... npm run test:integration
 */
const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");

const url = process.env.TEST_DATABASE_URL;

describe("daily workflow, end to end", { skip: !url && "TEST_DATABASE_URL not set" }, () => {
  const suffix = Date.now().toString(36);
  const PASSWORD = "Workflow#2026";
  let server;
  let base;
  let prisma;
  let bcrypt;
  const orgIds = [];

  const call = async (method, path, { token, body } = {}) => {
    const res = await fetch(`${base}/api${path}`, {
      method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, body: json };
  };

  const tokenOf = (res) => res.body?.data?.token || res.body?.data?.accessToken || res.body?.token || res.body?.accessToken;

  /** A company with an admin, an HR user and one employee, all verified and ready to log in. */
  const seedCompany = async (label) => {
    const email = (who) => `${who}.${label}.${suffix}@e2e.test`;
    const reg = await call("POST", "/auth/register", {
      body: { email: email("admin"), password: PASSWORD, organizationName: `E2E ${label} ${suffix}`, firstName: "Ada", lastName: "Admin" },
    });
    assert.ok([200, 201].includes(reg.status), `register failed: ${reg.status} ${JSON.stringify(reg.body)}`);

    const admin = await prisma.user.findFirst({ where: { email: email("admin") } });
    assert.ok(admin, "the admin user was created");
    orgIds.push(admin.organizationId);
    // Email verification is a separate flow; here the account is simply marked verified.
    await prisma.user.update({ where: { id: admin.id }, data: { emailVerifiedAt: new Date() } });

    const shift = await prisma.shift.create({
      data: { organizationId: admin.organizationId, name: "Day", startTime: "00:00", endTime: "23:59" },
    });
    const branch = await prisma.branch.create({ data: { organizationId: admin.organizationId, name: `Main ${label}` } });

    const passwordHash = await bcrypt.hash(PASSWORD, 10);
    const makeStaff = async (who, role, first) => {
      const user = await prisma.user.create({
        data: { organizationId: admin.organizationId, email: email(who), passwordHash, role, emailVerifiedAt: new Date() },
      });
      const employee = await prisma.employee.create({
        data: {
          organizationId: admin.organizationId,
          userId: user.id,
          employeeCode: `E2E${label.toUpperCase()}${who.toUpperCase()}${suffix}`.slice(0, 30),
          firstName: first,
          lastName: "Tester",
          shiftId: shift.id,
          branchId: branch.id,
        },
      });
      return { user, employee, email: email(who) };
    };
    const hr = await makeStaff("hr", "MANAGER", "Hari");
    const worker = await makeStaff("worker", "EMPLOYEE", "Wren");
    return { orgId: admin.organizationId, adminEmail: email("admin"), hr, worker };
  };

  const login = async (email) => {
    const res = await call("POST", "/auth/login", { body: { email, password: PASSWORD } });
    assert.equal(res.status, 200, `login for ${email} failed: ${JSON.stringify(res.body)}`);
    const token = tokenOf(res);
    assert.ok(token, "login returns an access token");
    return token;
  };

  let a;
  let b;
  let tokens = {};

  before(async () => {
    process.env.DATABASE_URL = url;
    process.env.RUNTIME_DATABASE_URL = url;
    process.env.NODE_ENV = process.env.NODE_ENV || "test";
    process.env.ENABLE_SCHEDULER = "false";
    // No real email, WhatsApp or push: registration and approvals would otherwise message the fake addresses.
    const { installModule } = require("../helpers/mockPrisma");
    const delivered = new Proxy({}, { get: () => async () => ({ success: true }) });
    for (const name of ["email", "whatsapp", "notification"]) installModule(require.resolve(`../../src/services/${name}.service`), delivered);
    prisma = require("../../src/config/database");
    bcrypt = require("bcryptjs");
    const app = require("../../src/app");
    server = app.listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    base = `http://127.0.0.1:${server.address().port}`;
    a = await seedCompany("a");
    b = await seedCompany("b");
  });

  after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (prisma && orgIds.length) {
      // Children first; the tenant guard is bypassed by deleting through raw SQL per table.
      for (const table of ["AttendanceCorrection", "Attendance", "Employee", "User", "Shift", "Branch", "Subscription", "Organization"]) {
        const col = table === "Organization" ? "id" : "organizationId";
        await prisma.$executeRawUnsafe(`DELETE FROM "${table}" WHERE "${col}" = ANY($1::text[])`, orgIds).catch(() => {});
      }
      await prisma.$disconnect();
    }
  });

  it("everyone can log in, and a wrong password is refused", async () => {
    tokens.admin = await login(a.adminEmail);
    tokens.hr = await login(a.hr.email);
    tokens.worker = await login(a.worker.email);
    const bad = await call("POST", "/auth/login", { body: { email: a.worker.email, password: "wrong-password-1" } });
    assert.equal(bad.status, 401);
  });

  it("an employee punches in and out and the day shows on their history", async () => {
    const before = await call("GET", "/attendance/today", { token: tokens.worker });
    assert.equal(before.status, 200);

    const punchIn = await call("POST", "/attendance/check-in-wfh", {
      token: tokens.worker,
      body: { latitude: 11.6643, longitude: 78.146, accuracy: 20, wfhNote: "e2e" },
    });
    assert.ok([200, 201].includes(punchIn.status), `punch in failed: ${punchIn.status} ${JSON.stringify(punchIn.body)}`);

    const again = await call("POST", "/attendance/check-in-wfh", {
      token: tokens.worker,
      body: { latitude: 11.6643, longitude: 78.146, accuracy: 20, wfhNote: "e2e" },
    });
    assert.ok(again.status >= 400, "a second punch in the same day is refused");

    const punchOut = await call("POST", "/attendance/check-out", {
      token: tokens.worker,
      body: { latitude: 11.6643, longitude: 78.146, accuracy: 20 },
    });
    assert.ok([200, 201].includes(punchOut.status), `punch out failed: ${punchOut.status} ${JSON.stringify(punchOut.body)}`);

    const row = await prisma.attendance.findFirst({ where: { employeeId: a.worker.employee.id } });
    assert.ok(row?.checkIn && row?.checkOut, "the attendance row has both punches");
  });

  it("an employee asks for a correction and HR approves it", async () => {
    const row = await prisma.attendance.findFirst({ where: { employeeId: a.worker.employee.id } });
    const day = row.date.toISOString().slice(0, 10);
    const early = new Date(`${day}T03:30:00.000Z`).toISOString();
    const late = new Date(`${day}T12:30:00.000Z`).toISOString();

    const created = await call("POST", "/attendance/corrections", {
      token: tokens.worker,
      body: { date: day, attendanceId: row.id, requestedCheckIn: early, requestedCheckOut: late, reason: "Forgot to punch on time" },
    });
    assert.ok([200, 201].includes(created.status), `request failed: ${created.status} ${JSON.stringify(created.body)}`);
    const requestId = created.body?.data?.id || created.body?.id;
    assert.ok(requestId, "the request has an id");

    const noReviewForEmployee = await call("PUT", `/attendance/corrections/${requestId}/review`, {
      token: tokens.worker,
      body: { status: "APPROVED" },
    });
    assert.equal(noReviewForEmployee.status, 403, "an employee cannot approve their own request");

    const pending = await call("GET", "/attendance/corrections/pending", { token: tokens.hr });
    assert.equal(pending.status, 200);
    assert.ok(JSON.stringify(pending.body).includes(requestId), "HR sees the pending request");

    const approved = await call("PUT", `/attendance/corrections/${requestId}/review`, {
      token: tokens.hr,
      body: { status: "APPROVED", reviewNote: "Confirmed" },
    });
    assert.equal(approved.status, 200, `approve failed: ${JSON.stringify(approved.body)}`);

    const updated = await prisma.attendance.findUnique({ where: { id: row.id } });
    assert.equal(updated.checkIn.toISOString(), early, "the approved punch-in time is applied");
    assert.equal(updated.checkOut.toISOString(), late, "the approved punch-out time is applied");
  });

  it("another company sees none of it and cannot act on it", async () => {
    tokens.otherAdmin = await login(b.adminEmail);
    const list = await call("GET", "/attendance/corrections", { token: tokens.otherAdmin });
    assert.equal(list.status, 200);
    assert.ok(!JSON.stringify(list.body).includes(a.worker.employee.id), "company B never sees company A's staff");

    const employees = await call("GET", "/employees", { token: tokens.otherAdmin });
    assert.equal(employees.status, 200);
    assert.ok(!JSON.stringify(employees.body).includes(a.worker.employee.id));

    const request = await prisma.attendanceCorrection.findFirst({ where: { employeeId: a.worker.employee.id } });
    const poke = await call("PUT", `/attendance/corrections/${request.id}/review`, {
      token: tokens.otherAdmin,
      body: { status: "REJECTED" },
    });
    assert.ok(poke.status >= 400, "company B cannot review company A's request");
  });

  it("requests without a valid token are refused", async () => {
    assert.equal((await call("GET", "/attendance/today")).status, 401);
    assert.equal((await call("GET", "/employees", { token: "not-a-token" })).status, 401);
  });
});
