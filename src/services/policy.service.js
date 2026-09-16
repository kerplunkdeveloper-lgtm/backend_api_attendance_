const prisma = require("../config/database");

const DEFAULT_POLICY = {
  workingDaysPerMonth: 26,
  halfDayThresholdMinutes: 240,
  maxLatesBeforeDeduction: 3,
  lateDeductionPercent: 0.25,
  allowWfh: true,
  requireOtApproval: false,
  geofenceStrict: true,
};

class PolicyService {
  /**
   * Get the org attendance policy (returns defaults if not configured)
   */
  async getPolicy(organizationId) {
    const policy = await prisma.attendancePolicy.findUnique({
      where: { organizationId },
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
    } = data;

    const payload = {};
    if (workingDaysPerMonth !== undefined) payload.workingDaysPerMonth = parseInt(workingDaysPerMonth);
    if (halfDayThresholdMinutes !== undefined) payload.halfDayThresholdMinutes = parseInt(halfDayThresholdMinutes);
    if (maxLatesBeforeDeduction !== undefined) payload.maxLatesBeforeDeduction = parseInt(maxLatesBeforeDeduction);
    if (lateDeductionPercent !== undefined) payload.lateDeductionPercent = Number(lateDeductionPercent);
    if (allowWfh !== undefined) payload.allowWfh = Boolean(allowWfh);
    if (requireOtApproval !== undefined) payload.requireOtApproval = Boolean(requireOtApproval);
    if (geofenceStrict !== undefined) payload.geofenceStrict = Boolean(geofenceStrict);

    const policy = await prisma.attendancePolicy.upsert({
      where: { organizationId },
      update: payload,
      create: { organizationId, ...DEFAULT_POLICY, ...payload },
    });

    return {
      ...policy,
      lateDeductionPercent: Number(policy.lateDeductionPercent),
    };
  }
}

module.exports = new PolicyService();
