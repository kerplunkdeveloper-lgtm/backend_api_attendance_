const prisma = require("../config/database");
const { parsePagination, paginationMeta } = require("../utils/pagination");
const { applyPaidPlan, PLAN_KEYS, BILLING_CYCLES } = require("./billing.service");
const { getPlan } = require("../config/plans");
const { SEAT_STATUSES: SEATS } = require("../config/plans");

const PLANS = ["FREE_TRIAL", "STARTER", "PROFESSIONAL", "ENTERPRISE"];
const STATUSES = ["TRIALING", "ACTIVE", "PAST_DUE", "CANCELED", "EXPIRED"];
const SEAT_STATUSES = ["ACTIVE", "PROBATION", "NOTICE_PERIOD"];
const DAY = 86400000;

const num = (v) => (v == null ? 0 : Number(v));

/** Monthly recurring revenue contributed by one subscription. */
const monthlyValue = (sub) => {
  if (!sub || sub.status !== "ACTIVE" || sub.plan === "FREE_TRIAL") return 0;
  const price = num(sub.price);
  return String(sub.billingCycle).toUpperCase() === "ANNUAL" ? price / 12 : price;
};

const periodEnd = (org) => org.subscription?.currentPeriodEnd || org.subscriptionExpiresAt || org.trialEndsAt || null;

const daysLeft = (date) => (date ? Math.ceil((new Date(date).getTime() - Date.now()) / DAY) : null);

const adminContact = (org) => {
  const admin = (org.users || [])[0];
  if (!admin) return null;
  const name = `${admin.employee?.firstName || ""} ${admin.employee?.lastName || ""}`.trim();
  return { name: name || null, email: admin.email, lastLoginAt: admin.lastLoginAt || null };
};

const clientInclude = {
  subscription: true,
  users: {
    where: { role: "COMPANY_ADMIN", isActive: true },
    orderBy: { createdAt: "asc" },
    take: 1,
    select: { email: true, lastLoginAt: true, employee: { select: { firstName: true, lastName: true } } },
  },
  _count: {
    select: {
      employees: { where: { deletedAt: null, status: { in: SEAT_STATUSES } } },
      branches: true,
    },
  },
};

const serializeClient = (org) => {
  const end = periodEnd(org);
  return {
    id: org.id,
    name: org.name,
    email: org.email,
    phone: org.phone,
    createdAt: org.createdAt,
    plan: org.subscription?.plan || org.subscriptionPlan,
    status: org.subscription?.status || org.subscriptionStatus,
    billingCycle: org.subscription?.billingCycle || null,
    price: num(org.subscription?.price),
    monthlyValue: Math.round(monthlyValue(org.subscription)),
    employees: org._count?.employees ?? 0,
    maxEmployees: org.subscription?.maxEmployees || org.maxEmployees,
    branches: org._count?.branches ?? 0,
    maxBranches: org.subscription?.maxBranches ?? null,
    planLocked: org.planLocked,
    suspended: Boolean(org.suspendedAt),
    suspendedAt: org.suspendedAt || null,
    periodEnd: end,
    daysLeft: daysLeft(end),
    admin: adminContact(org),
  };
};

// Customer workspaces only: the owner's own platform workspace (it holds a SUPER_ADMIN) is never a client.
const liveOrgs = () => ({ deletedAt: null, users: { none: { role: "SUPER_ADMIN" } } });

const expiringClause = () => {
  const soon = new Date(Date.now() + 14 * DAY);
  const now = new Date();
  return [
    { subscription: { is: { currentPeriodEnd: { gte: now, lte: soon } } } },
    { subscriptionExpiresAt: { gte: now, lte: soon } },
    { subscriptionStatus: "TRIALING", trialEndsAt: { gte: now, lte: soon } },
  ];
};

async function overview() {
  const since30 = new Date(Date.now() - 30 * DAY);

  const [orgs, activeSeats, newClients, revenue, expiring, recent] = await Promise.all([
    prisma.organization.findMany({
      where: liveOrgs(),
      select: {
        subscriptionPlan: true,
        subscriptionStatus: true,
        subscription: { select: { plan: true, status: true, price: true, billingCycle: true } },
      },
    }),
    prisma.employee.count({ where: { deletedAt: null, status: { in: SEAT_STATUSES }, organization: liveOrgs() } }),
    prisma.organization.count({ where: { ...liveOrgs(), createdAt: { gte: since30 } } }),
    prisma.billingOrder.aggregate({ where: { status: "PAID", paidAt: { gte: since30 } }, _sum: { amountInr: true }, _count: true }),
    prisma.organization.count({ where: { ...liveOrgs(), OR: expiringClause() } }),
    prisma.billingOrder.findMany({
      where: { status: "PAID" },
      orderBy: { paidAt: "desc" },
      take: 6,
      select: { id: true, plan: true, billingCycle: true, amountInr: true, paidAt: true, organization: { select: { id: true, name: true } } },
    }),
  ]);

  const byStatus = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  const byPlan = Object.fromEntries(PLANS.map((p) => [p, 0]));
  let mrr = 0;
  let paying = 0;
  for (const org of orgs) {
    const status = org.subscription?.status || org.subscriptionStatus;
    const plan = org.subscription?.plan || org.subscriptionPlan;
    byStatus[status] = (byStatus[status] || 0) + 1;
    byPlan[plan] = (byPlan[plan] || 0) + 1;
    mrr += monthlyValue(org.subscription);
    if (status === "ACTIVE" && plan !== "FREE_TRIAL") paying += 1;
  }

  return {
    totalClients: orgs.length,
    payingClients: paying,
    trialClients: byStatus.TRIALING,
    byStatus,
    byPlan,
    mrrInr: Math.round(mrr),
    arrInr: Math.round(mrr * 12),
    revenueLast30DaysInr: Math.round(num(revenue._sum.amountInr)),
    paidOrdersLast30Days: revenue._count,
    activeSeats,
    newClientsLast30Days: newClients,
    expiringSoon: expiring,
    recentPayments: recent.map((o) => ({
      id: o.id,
      clientId: o.organization?.id,
      client: o.organization?.name,
      plan: o.plan,
      billingCycle: o.billingCycle,
      amountInr: Math.round(num(o.amountInr)),
      paidAt: o.paidAt,
    })),
  };
}

const SORTS = {
  newest: { createdAt: "desc" },
  oldest: { createdAt: "asc" },
  name: { name: "asc" },
};

async function listClients(query = {}) {
  const { page, limit, skip } = parsePagination(query, { defaultLimit: 20, maxLimit: 100 });
  const where = liveOrgs();
  const search = typeof query.search === "string" ? query.search.trim().slice(0, 80) : "";
  if (search) {
    where.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { email: { contains: search, mode: "insensitive" } },
      { users: { some: { role: "COMPANY_ADMIN", email: { contains: search, mode: "insensitive" } } } },
    ];
  }
  if (PLANS.includes(query.plan)) where.subscriptionPlan = query.plan;
  if (STATUSES.includes(query.status)) where.subscriptionStatus = query.status;
  if (query.expiring === "true") where.AND = [{ OR: expiringClause() }];

  const [orgs, total] = await Promise.all([
    prisma.organization.findMany({ where, include: clientInclude, orderBy: SORTS[query.sort] || SORTS.newest, skip, take: limit }),
    prisma.organization.count({ where }),
  ]);
  return { records: orgs.map(serializeClient), ...paginationMeta(total, page, limit) };
}

async function getClient(id) {
  const org = await prisma.organization.findFirst({ where: { id, ...liveOrgs() }, include: clientInclude });
  if (!org) throw Object.assign(new Error("Client not found"), { statusCode: 404 });

  const [orders, paidTotal, lastActive, departments, activity, reasonRow] = await Promise.all([
    prisma.billingOrder.findMany({
      where: { organizationId: id },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        plan: true,
        billingCycle: true,
        amountInr: true,
        discountAmountInr: true,
        couponCode: true,
        status: true,
        createdAt: true,
        paidAt: true,
      },
    }),
    prisma.billingOrder.aggregate({ where: { organizationId: id, status: "PAID" }, _sum: { amountInr: true }, _count: true }),
    prisma.user.aggregate({ where: { organizationId: id }, _max: { lastLoginAt: true } }),
    prisma.department.count({ where: { organizationId: id } }),
    prisma.auditLog.findMany({
      where: { organizationId: id, entity: "PLATFORM" },
      orderBy: { createdAt: "desc" },
      take: 15,
    }),
    prisma.organization.findUnique({ where: { id }, select: { suspendReason: true } }),
  ]);

  const actorIds = [...new Set(activity.map((a) => a.userId).filter(Boolean))];
  const actors = actorIds.length
    ? await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, email: true } })
    : [];
  const actorEmail = new Map(actors.map((u) => [u.id, u.email]));

  return {
    ...serializeClient(org),
    address: org.address,
    timezone: org.timezone,
    currency: org.currency,
    planActivatedAt: org.planActivatedAt,
    features: org.subscription
      ? {
          geofence: org.subscription.hasGeofence,
          payroll: org.subscription.hasPayroll,
          shiftPlanner: org.subscription.hasShiftPlanner,
          apiAccess: org.subscription.hasApiAccess,
        }
      : null,
    departments,
    suspendReason: reasonRow?.suspendReason || null,
    activity: activity.map((a) => {
      let details = {};
      try {
        details = a.details ? JSON.parse(a.details) : {};
      } catch {
        details = { note: a.details };
      }
      return { id: a.id, action: a.action, at: a.createdAt, by: actorEmail.get(a.userId) || null, details };
    }),
    lastActiveAt: lastActive._max.lastLoginAt,
    lifetimePaidInr: Math.round(num(paidTotal._sum.amountInr)),
    paidOrders: paidTotal._count,
    orders: orders.map((o) => ({
      ...o,
      amountInr: Math.round(num(o.amountInr)),
      discountAmountInr: Math.round(num(o.discountAmountInr)),
    })),
  };
}

const fail = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });

const ACTIONS = ["EXTEND", "CHANGE_PLAN", "SUSPEND", "REACTIVATE"];

/**
 * Owner-level change to a client workspace. Every action is validated, runs in
 * one transaction with its audit entry, and (for suspension) must be confirmed
 * by typing the client's name.
 */
async function applyAction(id, actor, body = {}) {
  const action = String(body.action || "").toUpperCase();
  if (!ACTIONS.includes(action)) throw fail("Unknown action");
  if (id === actor.organizationId) throw fail("You cannot change your own platform workspace.");

  const org = await prisma.organization.findFirst({
    where: { id, ...liveOrgs() },
    include: { subscription: true },
  });
  if (!org) throw fail("Client not found", 404);

  const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : "";
  const now = new Date();
  const currentPlan = org.subscription?.plan || org.subscriptionPlan;
  const currentStatus = org.subscription?.status || org.subscriptionStatus;
  const currentEnd = periodEnd(org);
  const before = { plan: currentPlan, status: currentStatus, periodEnd: currentEnd, suspended: Boolean(org.suspendedAt) };
  let after;
  let auditAction;
  let extra = {};

  await prisma.$transaction(async (tx) => {
    if (action === "EXTEND") {
      const isTrial = currentPlan === "FREE_TRIAL";
      const days = Number(body.days);
      const maxDays = isTrial ? 90 : 365;
      if (!Number.isInteger(days) || days < 1 || days > maxDays) {
        throw fail(`Choose between 1 and ${maxDays} days.`);
      }
      const base = currentEnd && new Date(currentEnd) > now ? new Date(currentEnd) : now;
      const newEnd = new Date(base.getTime() + days * DAY);
      if (isTrial) {
        await tx.organization.update({
          where: { id },
          data: { subscriptionStatus: "TRIALING", trialEndsAt: newEnd, subscriptionExpiresAt: newEnd },
        });
        if (org.subscription) {
          await tx.subscription.update({
            where: { organizationId: id },
            data: { status: "TRIALING", trialEndsAt: newEnd, currentPeriodEnd: newEnd },
          });
        }
        auditAction = "TRIAL_EXTENDED";
      } else {
        await tx.organization.update({ where: { id }, data: { subscriptionStatus: "ACTIVE", subscriptionExpiresAt: newEnd } });
        if (org.subscription) {
          await tx.subscription.update({ where: { organizationId: id }, data: { status: "ACTIVE", currentPeriodEnd: newEnd } });
        }
        auditAction = "PERIOD_EXTENDED";
      }
      after = { plan: currentPlan, status: isTrial ? "TRIALING" : "ACTIVE", periodEnd: newEnd, suspended: before.suspended };
      extra = { days };
    }

    if (action === "CHANGE_PLAN") {
      const plan = String(body.plan || "").toUpperCase();
      const cycle = String(body.billingCycle || "MONTHLY").toUpperCase();
      if (!PLAN_KEYS.includes(plan)) throw fail("Choose Starter, Professional or Enterprise.");
      if (!BILLING_CYCLES.includes(cycle)) throw fail("Billing cycle must be monthly or annual.");
      if (plan === currentPlan && cycle === (org.subscription?.billingCycle || "MONTHLY") && currentStatus === "ACTIVE") {
        throw fail("This client is already on that plan.");
      }
      if (reason.length < 5) throw fail("Add a short reason for the plan change.");

      const meta = getPlan(plan);
      const [seats, branches] = await Promise.all([
        tx.employee.count({ where: { organizationId: id, deletedAt: null, status: { in: SEATS } } }),
        tx.branch.count({ where: { organizationId: id } }),
      ]);
      if (seats > meta.maxEmployees) {
        throw fail(`${org.name} has ${seats} active employees, but ${meta.plan} allows ${meta.maxEmployees}. They must reduce headcount first.`);
      }
      if (branches > meta.maxBranches) {
        throw fail(`${org.name} has ${branches} branches, but ${meta.plan} allows ${meta.maxBranches}. They must remove branches first.`);
      }
      const end = await applyPaidPlan(id, plan, cycle, { tx });
      after = { plan, status: "ACTIVE", periodEnd: end, suspended: before.suspended, billingCycle: cycle };
      auditAction = "PLAN_CHANGED";
    }

    if (action === "SUSPEND") {
      if (org.suspendedAt) throw fail("This client is already suspended.");
      if (reason.length < 5) throw fail("Add a reason for the suspension.");
      const typed = String(body.confirmName || "").trim().toLowerCase();
      if (typed !== String(org.name).trim().toLowerCase()) throw fail("Type the client's exact name to confirm the suspension.");
      await tx.organization.update({ where: { id }, data: { suspendedAt: now, suspendReason: reason } });
      after = { ...before, suspended: true };
      auditAction = "SUSPENDED";
    }

    if (action === "REACTIVATE") {
      if (!org.suspendedAt) throw fail("This client is not suspended.");
      await tx.organization.update({ where: { id }, data: { suspendedAt: null, suspendReason: null } });
      after = { ...before, suspended: false };
      auditAction = "REACTIVATED";
    }

    await tx.auditLog.create({
      data: {
        organizationId: id,
        userId: actor.userId || null,
        action: auditAction,
        entity: "PLATFORM",
        entityId: id,
        details: JSON.stringify({ before, after, reason: reason || undefined, ...extra }),
        ipAddress: actor.ip || null,
      },
    });
  }, { timeout: 20000, maxWait: 10000 });

  return getClient(id);
}

const SEAT_WARN_PCT = 90;
const INACTIVE_DAYS = 30;
const UNLOCK_WAIT_DAYS = 3;
const ATTENTION_LIMIT = 25;

/**
 * Clients that need the owner's attention, grouped by reason. Computed from
 * live data so it is always current.
 */
async function attention() {
  const [orgs, logins] = await Promise.all([
    prisma.organization.findMany({
      where: liveOrgs(),
      include: {
        subscription: true,
        users: {
          where: { role: "COMPANY_ADMIN", isActive: true },
          orderBy: { createdAt: "asc" },
          take: 1,
          select: { email: true },
        },
        _count: { select: { employees: { where: { deletedAt: null, status: { in: SEAT_STATUSES } } } } },
      },
      take: 1000,
    }),
    prisma.user.groupBy({ by: ["organizationId"], _max: { lastLoginAt: true } }),
  ]);
  const lastLogin = new Map(logins.map((l) => [l.organizationId, l._max.lastLoginAt]));
  const now = Date.now();

  const groups = { pastDue: [], seatLimit: [], inactive: [], awaitingUnlock: [], suspended: [] };
  for (const org of orgs) {
    const status = org.subscription?.status || org.subscriptionStatus;
    const plan = org.subscription?.plan || org.subscriptionPlan;
    const seats = org._count.employees;
    const max = org.subscription?.maxEmployees || org.maxEmployees || 0;
    const base = { id: org.id, name: org.name, plan, status, admin: org.users[0]?.email || org.email || null };

    if (org.suspendedAt) {
      groups.suspended.push({ ...base, detail: `Suspended ${Math.max(0, Math.floor((now - new Date(org.suspendedAt).getTime()) / DAY))} days ago` });
      continue; // a suspended client does not also need chasing for the rest
    }
    if (status === "PAST_DUE" || (status === "EXPIRED" && plan !== "FREE_TRIAL")) {
      groups.pastDue.push({ ...base, detail: status === "PAST_DUE" ? "Payment overdue" : "Subscription expired" });
    }
    if (max > 0 && seats / max >= SEAT_WARN_PCT / 100) {
      groups.seatLimit.push({ ...base, detail: `${seats} of ${max} seats used (${Math.round((seats / max) * 100)}%)`, pct: Math.round((seats / max) * 100) });
    }
    const last = lastLogin.get(org.id);
    const idleDays = last ? Math.floor((now - new Date(last).getTime()) / DAY) : null;
    if (["ACTIVE", "TRIALING"].includes(status) && (idleDays === null || idleDays >= INACTIVE_DAYS)) {
      const age = Math.floor((now - new Date(org.createdAt).getTime()) / DAY);
      // A brand new workspace that has not signed in yet is not "inactive" so much as unstarted.
      if (idleDays !== null || age >= 7) {
        groups.inactive.push({ ...base, detail: idleDays === null ? "Never signed in" : `No sign-in for ${idleDays} days`, idleDays: idleDays ?? 9999 });
      }
    }
    if (org.planLocked && plan !== "FREE_TRIAL" && now - new Date(org.createdAt).getTime() > UNLOCK_WAIT_DAYS * DAY) {
      groups.awaitingUnlock.push({ ...base, detail: "Paid plan not unlocked yet" });
    }
  }
  groups.seatLimit.sort((a, b) => b.pct - a.pct);
  groups.inactive.sort((a, b) => b.idleDays - a.idleDays);

  const out = {};
  let total = 0;
  for (const [key, list] of Object.entries(groups)) {
    out[key] = { count: list.length, items: list.slice(0, ATTENTION_LIMIT) };
    total += list.length;
  }
  return { total, ...out };
}

const ACTION_LABELS = {
  TRIAL_EXTENDED: "Trial extended",
  PERIOD_EXTENDED: "Paid period extended",
  PLAN_CHANGED: "Plan changed",
  SUSPENDED: "Workspace suspended",
  REACTIVATED: "Workspace reactivated",
};

/** Every owner action across all clients, newest first. */
async function activityLog(query = {}) {
  const { page, limit, skip } = parsePagination(query, { defaultLimit: 25, maxLimit: 100 });
  const where = { entity: "PLATFORM" };
  if (ACTION_LABELS[query.action]) where.action = query.action;
  if (typeof query.clientId === "string" && query.clientId) where.organizationId = query.clientId;

  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
      include: { organization: { select: { id: true, name: true } } },
    }),
    prisma.auditLog.count({ where }),
  ]);
  const actorIds = [...new Set(rows.map((r) => r.userId).filter(Boolean))];
  const actors = actorIds.length ? await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, email: true } }) : [];
  const email = new Map(actors.map((u) => [u.id, u.email]));

  const records = rows.map((r) => {
    let details = {};
    try {
      details = r.details ? JSON.parse(r.details) : {};
    } catch {
      details = { note: r.details };
    }
    return {
      id: r.id,
      at: r.createdAt,
      action: r.action,
      label: ACTION_LABELS[r.action] || r.action,
      clientId: r.organization?.id || null,
      client: r.organization?.name || "Deleted client",
      by: email.get(r.userId) || null,
      ip: r.ipAddress || null,
      details,
    };
  });
  return { records, ...paginationMeta(total, page, limit) };
}

module.exports = { overview, listClients, getClient, applyAction, attention, activityLog, monthlyValue };
