const prisma = require("../config/database");
const { PLAN_INR, BILLING_OFFERS, PLAN_KEYS, BILLING_CYCLES, clearPlanCatalogCache } = require("./billing.service");
const { getPlan } = require("../config/plans");

const normalizePlan = (value) => String(value || "").trim().toUpperCase();
const normalizeCycle = (value) => String(value || "").trim().toUpperCase();
const normalizeCode = (value) => String(value || "").trim().toUpperCase();

const assertPlan = (plan) => {
  if (!PLAN_KEYS.includes(plan)) throw Object.assign(new Error("Invalid paid plan"), { statusCode: 400 });
};

const assertCycle = (cycle) => {
  if (!BILLING_CYCLES.includes(cycle)) throw Object.assign(new Error("Billing cycle must be MONTHLY or ANNUAL"), { statusCode: 400 });
};

const serializePrice = (item) => ({
  ...item,
  priceInr: Number(item.priceInr),
});

const serializeOffer = (item) => ({
  ...item,
  value: Number(item.value),
  maxDiscountInr: item.maxDiscountInr == null ? null : Number(item.maxDiscountInr),
});

async function listPlanPrices() {
  const rows = await prisma.billingPlanPrice.findMany({ orderBy: [{ plan: "asc" }, { billingCycle: "asc" }] });
  const existing = new Map(rows.map((row) => [`${row.plan}:${row.billingCycle}`, row]));
  return PLAN_KEYS.flatMap((plan) => BILLING_CYCLES.map((billingCycle) => {
    const row = existing.get(`${plan}:${billingCycle}`);
    return serializePrice(row || {
      id: null,
      plan,
      billingCycle,
      priceInr: PLAN_INR[plan][billingCycle],
      isActive: true,
      updatedByUserId: null,
      createdAt: null,
      updatedAt: null,
    });
  }));
}

async function upsertPlanPrice({ plan, billingCycle, priceInr, isActive = true, userId }) {
  const normalizedPlan = normalizePlan(plan);
  const normalizedCycle = normalizeCycle(billingCycle);
  assertPlan(normalizedPlan);
  assertCycle(normalizedCycle);
  const value = Number(priceInr);
  if (!Number.isInteger(value) || value < 0 || value > 100000000) {
    throw Object.assign(new Error("Price must be a whole INR amount between 0 and 100,000,000"), { statusCode: 400 });
  }
  const row = await prisma.billingPlanPrice.upsert({
    where: { plan_billingCycle: { plan: normalizedPlan, billingCycle: normalizedCycle } },
    update: { priceInr: value, isActive: Boolean(isActive), updatedByUserId: userId || null },
    create: { plan: normalizedPlan, billingCycle: normalizedCycle, priceInr: value, isActive: Boolean(isActive), updatedByUserId: userId || null },
  });
  clearPlanCatalogCache();
  return serializePrice(row);
}

const serializeLimit = (row) => ({ ...row });

async function listPlanLimits() {
  const rows = await prisma.billingPlanLimit.findMany({ orderBy: { plan: "asc" } });
  const byPlan = new Map(rows.map((row) => [row.plan, row]));
  return PLAN_KEYS.map((plan) => serializeLimit(byPlan.get(plan) || {
    id: null, plan, maxEmployees: getPlan(plan).maxEmployees, maxBranches: getPlan(plan).maxBranches,
    hasGeofence: getPlan(plan).hasGeofence, hasPayroll: getPlan(plan).hasPayroll,
    hasShiftPlanner: getPlan(plan).hasShiftPlanner, hasApiAccess: getPlan(plan).hasApiAccess,
    updatedByUserId: null, createdAt: null, updatedAt: null,
  }));
}

async function upsertPlanLimit({ plan, maxEmployees, maxBranches, hasGeofence, hasPayroll, hasShiftPlanner, hasApiAccess, userId }) {
  const normalizedPlan = normalizePlan(plan);
  assertPlan(normalizedPlan);
  const seats = Number(maxEmployees); const branches = Number(maxBranches);
  if (!Number.isInteger(seats) || seats < 1 || seats > 10000000) throw Object.assign(new Error("Employee limit must be a whole number between 1 and 10,000,000"), { statusCode: 400 });
  if (!Number.isInteger(branches) || branches < 1 || branches > 100000) throw Object.assign(new Error("Branch limit must be a whole number between 1 and 100,000"), { statusCode: 400 });
  const row = await prisma.billingPlanLimit.upsert({
    where: { plan: normalizedPlan },
    update: { maxEmployees: seats, maxBranches: branches, hasGeofence: Boolean(hasGeofence), hasPayroll: Boolean(hasPayroll), hasShiftPlanner: Boolean(hasShiftPlanner), hasApiAccess: Boolean(hasApiAccess), updatedByUserId: userId || null },
    create: { plan: normalizedPlan, maxEmployees: seats, maxBranches: branches, hasGeofence: Boolean(hasGeofence), hasPayroll: Boolean(hasPayroll), hasShiftPlanner: Boolean(hasShiftPlanner), hasApiAccess: Boolean(hasApiAccess), updatedByUserId: userId || null },
  });
  clearPlanCatalogCache();
  return serializeLimit(row);
}

async function listOffers() {
  const rows = await prisma.billingOffer.findMany({ orderBy: { createdAt: "desc" } });
  return rows.map(serializeOffer);
}

function offerData(payload, userId, partial = false) {
  const data = {};
  if (!partial || payload.code !== undefined) data.code = normalizeCode(payload.code);
  if (!partial || payload.label !== undefined) data.label = String(payload.label || "").trim();
  if (!partial || payload.type !== undefined) data.type = String(payload.type || "").toUpperCase();
  if (!partial || payload.value !== undefined) data.value = Number(payload.value);
  if (!partial || payload.maxDiscountInr !== undefined) data.maxDiscountInr = payload.maxDiscountInr == null ? null : Number(payload.maxDiscountInr);
  if (!partial || payload.eligiblePlans !== undefined) data.eligiblePlans = (payload.eligiblePlans || []).map(normalizePlan);
  if (!partial || payload.eligibleCycles !== undefined) data.eligibleCycles = (payload.eligibleCycles || []).map(normalizeCycle);
  if (!partial || payload.firstPaidOrderOnly !== undefined) data.firstPaidOrderOnly = Boolean(payload.firstPaidOrderOnly);
  if (!partial || payload.isActive !== undefined) data.isActive = Boolean(payload.isActive);
  if (!partial || payload.startsAt !== undefined) data.startsAt = payload.startsAt ? new Date(payload.startsAt) : null;
  if (!partial || payload.expiresAt !== undefined) data.expiresAt = payload.expiresAt ? new Date(payload.expiresAt) : null;
  if (!partial || payload.createdByUserId !== undefined) data.createdByUserId = userId || null;
  data.updatedByUserId = userId || null;

  // Only fields that were sent are checked: a partial update such as
  // { isActive: false } must not fail on fields it never mentions.
  const sent = (key) => data[key] !== undefined;
  if (sent("code") && !/^[A-Z0-9][A-Z0-9_-]{2,39}$/.test(data.code)) throw Object.assign(new Error("Offer code must be 3-40 letters, numbers, underscores or hyphens"), { statusCode: 400 });
  if (sent("label") && (!data.label || data.label.length > 160)) throw Object.assign(new Error("Offer label is required and must be at most 160 characters"), { statusCode: 400 });
  if (sent("type") && !["PERCENTAGE", "FIXED"].includes(data.type)) throw Object.assign(new Error("Offer type must be PERCENTAGE or FIXED"), { statusCode: 400 });
  if (sent("value") && (!Number.isFinite(data.value) || data.value < 0)) throw Object.assign(new Error("Offer value is invalid"), { statusCode: 400 });
  if (data.maxDiscountInr != null && (!Number.isFinite(data.maxDiscountInr) || data.maxDiscountInr < 0)) throw Object.assign(new Error("Maximum discount is invalid"), { statusCode: 400 });
  if (data.eligiblePlans?.some((plan) => !PLAN_KEYS.includes(plan))) throw Object.assign(new Error("Offer contains an invalid plan"), { statusCode: 400 });
  if (data.eligibleCycles?.some((cycle) => !BILLING_CYCLES.includes(cycle))) throw Object.assign(new Error("Offer contains an invalid billing cycle"), { statusCode: 400 });
  if (data.startsAt && Number.isNaN(data.startsAt.getTime())) throw Object.assign(new Error("Offer start date is invalid"), { statusCode: 400 });
  if (data.expiresAt && Number.isNaN(data.expiresAt.getTime())) throw Object.assign(new Error("Offer expiry date is invalid"), { statusCode: 400 });
  return data;
}

/** Rules that span fields, checked against the offer as it will look after the change. */
function assertOfferConsistent(offer) {
  if (offer.type === "PERCENTAGE" && Number(offer.value) > 100) throw Object.assign(new Error("Offer value is invalid"), { statusCode: 400 });
  if (offer.startsAt && offer.expiresAt && new Date(offer.expiresAt) < new Date(offer.startsAt)) throw Object.assign(new Error("Offer expiry must be after its start"), { statusCode: 400 });
}

async function createOffer(payload, userId) {
  const data = offerData(payload, userId);
  assertOfferConsistent(data);
  const row = await prisma.billingOffer.create({ data });
  return serializeOffer(row);
}

async function updateOffer(id, payload, userId) {
  const data = offerData(payload, userId, true);
  const existing = await prisma.billingOffer.findUnique({ where: { id } });
  if (!existing) throw Object.assign(new Error("Offer not found"), { statusCode: 404 });
  assertOfferConsistent({ ...existing, ...data });
  const row = await prisma.billingOffer.update({ where: { id }, data });
  return serializeOffer(row);
}

async function deactivateOffer(id, userId) {
  const row = await prisma.billingOffer.update({ where: { id }, data: { isActive: false, updatedByUserId: userId || null } });
  return serializeOffer(row);
}

module.exports = { listPlanPrices, upsertPlanPrice, listPlanLimits, upsertPlanLimit, listOffers, createOffer, updateOffer, deactivateOffer, BILLING_OFFERS };
