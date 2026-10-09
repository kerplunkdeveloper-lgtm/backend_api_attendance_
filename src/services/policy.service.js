const prisma = require("../config/database");
const { policySelect } = require("../utils/prismaSelects");
const { normalizeCycleDay, normalizeDayBasis } = require("../utils/payrollCycle");

const DEFAULT_POLICY = {
  workingDaysPerMonth: 26,
  probationMonths: 3,
  monthlyPermissionHours: 3,
  permissionRequiresProbation: true,
  payrollCycleStartDay: 1,
  payrollCycleEndDay: 31,
  payrollDayBasis: "ACTUAL_DAYS",
  halfDayThresholdMinutes: 240,
  maxLatesBeforeDeduction: 3,
  lateDeductionPercent: 0.25,
  allowWfh: true,
  requireOtApproval: false,
  geofenceStrict: false,
  requireTrustedDevice: false,
};

const parseBoolean = (value) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value.trim().toLowerCase() === "true" || value.trim() === "1";
  return value === 1;
};

class PolicyService {
  /**
   * Get the org attendance policy (returns defaults if not configured)
   */
  async getPolicy(organizationId) {
    const policy = await prisma.attendancePolicy.findUnique({
      where: { organizationId },
      select: policySelect,
    });

    if (!policy) {
      return { ...DEFAULT_POLICY, organizationId, isDefault: true };
    }

    return {
      ...policy,
      lateDeductionPercent: Number(policy.lateDeductionPercent),
      monthlyPermissionHours: Number(policy.monthlyPermissionHours),
      isDefault: false,
    };
  }


  /**
   * Upsert org attendance policy
   */
  async upsertPolicy(organizationId, data) {
    const {
      workingDaysPerMonth,
      probationMonths,
      monthlyPermissionHours,
      permissionRequiresProbation,
      payrollCycleStartDay,
      payrollCycleEndDay,
      payrollDayBasis,
      halfDayThresholdMinutes,
      maxLatesBeforeDeduction,
      lateDeductionPercent,
      allowWfh,
      requireOtApproval,
      geofenceStrict,
      requireTrustedDevice,
    } = data;

    const payload = {};
    if (workingDaysPerMonth !== undefined) payload.workingDaysPerMonth = parseInt(workingDaysPerMonth);
    if (probationMonths !== undefined) payload.probationMonths = Math.max(0, parseInt(probationMonths));
    if (monthlyPermissionHours !== undefined) payload.monthlyPermissionHours = Math.max(0, Number(monthlyPermissionHours));
    if (permissionRequiresProbation !== undefined) payload.permissionRequiresProbation = parseBoolean(permissionRequiresProbation);
    if (payrollCycleStartDay !== undefined) payload.payrollCycleStartDay = normalizeCycleDay(payrollCycleStartDay, DEFAULT_POLICY.payrollCycleStartDay);
    if (payrollCycleEndDay !== undefined) payload.payrollCycleEndDay = normalizeCycleDay(payrollCycleEndDay, DEFAULT_POLICY.payrollCycleEndDay);
    if (payrollDayBasis !== undefined) payload.payrollDayBasis = normalizeDayBasis(payrollDayBasis, DEFAULT_POLICY.payrollDayBasis);
    if (halfDayThresholdMinutes !== undefined) payload.halfDayThresholdMinutes = parseInt(halfDayThresholdMinutes);
    if (maxLatesBeforeDeduction !== undefined) payload.maxLatesBeforeDeduction = parseInt(maxLatesBeforeDeduction);
    if (lateDeductionPercent !== undefined) payload.lateDeductionPercent = Number(lateDeductionPercent);
    if (allowWfh !== undefined) payload.allowWfh = parseBoolean(allowWfh);
    if (requireOtApproval !== undefined) payload.requireOtApproval = parseBoolean(requireOtApproval);
    if (geofenceStrict !== undefined) payload.geofenceStrict = parseBoolean(geofenceStrict);
    if (requireTrustedDevice !== undefined) payload.requireTrustedDevice = parseBoolean(requireTrustedDevice);
    const createPayload = { ...DEFAULT_POLICY, ...payload };

    const policy = await prisma.attendancePolicy.upsert({
      where: { organizationId },
      update: payload,
      create: { organizationId, ...createPayload },
    });

    return {
      ...policy,
      lateDeductionPercent: Number(policy.lateDeductionPercent),
      monthlyPermissionHours: Number(policy.monthlyPermissionHours),
    };
  }
}

module.exports = new PolicyService();
