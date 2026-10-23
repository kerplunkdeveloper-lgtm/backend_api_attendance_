/** Business rules for asset custody. Kept pure so they can be tested without a database. */

const STATUSES = ["AVAILABLE", "ASSIGNED", "UNDER_MAINTENANCE", "DAMAGED", "RETIRED", "LOST"];
const CONDITIONS = ["NEW", "EXCELLENT", "GOOD", "FAIR", "DAMAGED"];

const fail = (message, statusCode = 400) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  throw error;
};

const blank = (value) => value === undefined || value === null || value === "";

const parseDate = (label, value) => {
  if (blank(value)) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) fail(`${label} is not a valid date.`);
  return date;
};

const parseMoney = (label, value) => {
  if (blank(value)) return null;
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) fail(`${label} must be a number that is zero or more.`);
  return Math.round(amount * 100) / 100;
};

const assetRules = {
  /** Returns the parsed values for the fields that were supplied (undefined stays undefined). */
  validateDetails({ purchaseDate, purchaseCost, warrantyExpiry }) {
    const out = {};
    if (purchaseDate !== undefined) out.purchaseDate = parseDate("Purchase date", purchaseDate);
    if (purchaseCost !== undefined) out.purchaseCost = parseMoney("Purchase cost", purchaseCost);
    if (warrantyExpiry !== undefined) out.warrantyExpiry = parseDate("Warranty expiry", warrantyExpiry);
    if (out.purchaseDate && out.warrantyExpiry && out.warrantyExpiry < out.purchaseDate) {
      fail("Warranty cannot expire before the purchase date.");
    }
    return out;
  },

  validateReturn({ conditionOnReturn = "GOOD", recoveryCharge = 0 }) {
    const condition = String(conditionOnReturn).toUpperCase();
    if (!CONDITIONS.includes(condition)) fail(`Condition on return must be one of ${CONDITIONS.join(", ")}.`);
    return { conditionOnReturn: condition, recoveryCharge: parseMoney("Recovery charge", recoveryCharge) ?? 0 };
  },

  /** An asset can only be handed out from the shelf, never over the top of whoever holds it. */
  assertAssignable(asset) {
    if (asset.status === "ASSIGNED" || asset.assignedToId) {
      fail(`${asset.assetCode || "This asset"} is already assigned. Use Transfer to move it to someone else, or return it first.`, 409);
    }
    if (asset.status !== "AVAILABLE") {
      fail(`${asset.assetCode || "This asset"} is ${String(asset.status).toLowerCase().replace(/_/g, " ")} and cannot be assigned.`, 409);
    }
  },

  assertTransferable(asset, target) {
    if (!asset.assignedToId || asset.status !== "ASSIGNED") {
      fail("Only an assigned asset can be transferred. Assign it to someone instead.", 409);
    }
    if (asset.assignedToId === target.id) fail("The asset is already with this employee.", 409);
  },

  /** People who have left (terminated or deactivated) cannot be given equipment. */
  assertWorking(employee, workingStatuses) {
    if (!workingStatuses.includes(employee.status)) {
      fail("This employee has left the company, so assets can no longer be assigned to them.", 409);
    }
  },

  /** Status edits must agree with who holds the asset. Custody changes go through assign, return and transfer. */
  assertStatusChange(asset, nextStatus) {
    if (!STATUSES.includes(nextStatus)) fail(`Status must be one of ${STATUSES.join(", ")}.`);
    if (nextStatus === asset.status) return;
    if (nextStatus === "ASSIGNED") fail("Use Assign to give the asset to an employee.", 409);
    if (asset.assignedToId) fail("This asset is with an employee. Return it before changing its status.", 409);
  },

  addDue(existing, charge) {
    return Math.round((Number(existing || 0) + Number(charge || 0)) * 100) / 100;
  },
};

module.exports = { assetRules, STATUSES, CONDITIONS };
