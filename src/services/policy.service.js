const prisma = require("../config/database");
const { policySelect } = require("../utils/prismaSelects");

const DEFAULT_POLICY = {
  workingDaysPerMonth: 26,
  halfDayThresholdMinutes: 240,
  maxLatesBeforeDeduction: 3,
  lateDeductionPercent: 0.25,
  allowWfh: true,
  requireOtApproval: false,
  geofenceStrict: true,
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
      isDefault: false,
    };
  }


  /**
   * Upsert org attendance policy
   */
  async upsertPolicy(organizationId, data) {
    const {
      workingDaysPerMonth,
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
    };
  }
}

module.exports = new PolicyService();
