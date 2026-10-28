const prisma = require("../config/database");
const { boundedNumber, normalizeWeeklyOffDays, workingDaysFromWeeklyOff } = require("../utils/policyValidation");
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
  weeklyOffDays: "0",
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
      return { ...DEFAULT_POLICY, organizationId, leaveEligibilityActive: true, isDefault: true };
    }

    return {
      ...policy,
      lateDeductionPercent: Number(policy.lateDeductionPercent),
      monthlyPermissionHours: Number(policy.monthlyPermissionHours),
      leaveEligibilityActive: Boolean(policy.permissionRequiresProbation),
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
      leaveEligibilityActive,
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
      weeklyOffDays,
    } = data;

    const payload = {};
    if (workingDaysPerMonth !== undefined) payload.workingDaysPerMonth = boundedNumber("Working days per month", workingDaysPerMonth, { min: 1, max: 31, integer: true });
    if (probationMonths !== undefined) payload.probationMonths = boundedNumber("Probation months", probationMonths, { min: 0, max: 36, integer: true });
    if (monthlyPermissionHours !== undefined) payload.monthlyPermissionHours = boundedNumber("Monthly permission hours", monthlyPermissionHours, { min: 0, max: 100 });
    if (permissionRequiresProbation !== undefined) payload.permissionRequiresProbation = parseBoolean(permissionRequiresProbation);
    if (leaveEligibilityActive !== undefined) payload.permissionRequiresProbation = parseBoolean(leaveEligibilityActive);
    if (payrollCycleStartDay !== undefined) payload.payrollCycleStartDay = normalizeCycleDay(payrollCycleStartDay, DEFAULT_POLICY.payrollCycleStartDay);
    if (payrollCycleEndDay !== undefined) payload.payrollCycleEndDay = normalizeCycleDay(payrollCycleEndDay, DEFAULT_POLICY.payrollCycleEndDay);
    if (payrollDayBasis !== undefined) payload.payrollDayBasis = normalizeDayBasis(payrollDayBasis, DEFAULT_POLICY.payrollDayBasis);
    if (halfDayThresholdMinutes !== undefined) payload.halfDayThresholdMinutes = boundedNumber("Half-day threshold", halfDayThresholdMinutes, { min: 0, max: 1440, integer: true });
    if (maxLatesBeforeDeduction !== undefined) payload.maxLatesBeforeDeduction = boundedNumber("Lates before deduction", maxLatesBeforeDeduction, { min: 0, max: 31, integer: true });
    if (lateDeductionPercent !== undefined) payload.lateDeductionPercent = boundedNumber("Late deduction (fraction of daily rate)", lateDeductionPercent, { min: 0, max: 1 });
    if (allowWfh !== undefined) payload.allowWfh = parseBoolean(allowWfh);
    if (requireOtApproval !== undefined) payload.requireOtApproval = parseBoolean(requireOtApproval);
    if (geofenceStrict !== undefined) payload.geofenceStrict = parseBoolean(geofenceStrict);
    if (requireTrustedDevice !== undefined) payload.requireTrustedDevice = parseBoolean(requireTrustedDevice);
    if (weeklyOffDays !== undefined) payload.weeklyOffDays = normalizeWeeklyOffDays(weeklyOffDays);
    const createPayload = { ...DEFAULT_POLICY, ...payload };

    const save = () =>
      prisma.attendancePolicy.upsert({
        where: { organizationId },
        update: payload,
        create: { organizationId, ...createPayload },
      });

    let policy;
    let shiftsUpdated = 0;
    if (payload.weeklyOffDays !== undefined) {
      // Every shift in the company follows the company weekly off, so attendance, leave, payroll and the
      // absent marker (which all read the shift's working days) agree with the policy straight away.
      const workingDays = workingDaysFromWeeklyOff(payload.weeklyOffDays);
      const [saved, updated] = await prisma.$transaction([
        save(),
        prisma.shift.updateMany({ where: { organizationId }, data: { workingDays } }),
      ]);
      policy = saved;
      shiftsUpdated = updated.count;
    } else {
      policy = await save();
    }

    return {
      ...policy,
      lateDeductionPercent: Number(policy.lateDeductionPercent),
      monthlyPermissionHours: Number(policy.monthlyPermissionHours),
      leaveEligibilityActive: Boolean(policy.permissionRequiresProbation),
      ...(payload.weeklyOffDays !== undefined ? { shiftsUpdated } : {}),
    };
  }
  async listLateComingRules(organizationId) {
    const rules = await prisma.lateComingLopRule.findMany({ where: { organizationId }, orderBy: [{ lateDays: "asc" }, { createdAt: "asc" }] });
    return rules.map((rule) => ({ ...rule, lopDays: Number(rule.lopDays) }));
  }

  async createLateComingRule(organizationId, data) {
    const lateDays = Number(data.lateDays);
    const lopDays = Number(data.lopDays);
    const graceMinutes = Number(data.graceMinutes ?? 0);
    if (!Number.isInteger(lateDays) || lateDays < 1) throw new Error("Late days must be a positive whole number");
    if (!Number.isFinite(lopDays) || lopDays <= 0 || lopDays > 31) throw new Error("LOP days must be greater than 0 and no more than 31");
    if (!Number.isInteger(graceMinutes) || graceMinutes < 0 || graceMinutes > 1440) throw new Error("Grace time must be between 0 and 1440 minutes");
    const rule = await prisma.lateComingLopRule.create({ data: { organizationId, lateDays, lopDays, graceMinutes, isActive: data.isActive !== false, remarks: String(data.remarks || "").trim() || null } });
    return { ...rule, lopDays: Number(rule.lopDays) };
  }

  async updateLateComingRule(organizationId, id, data) {
    const existing = await prisma.lateComingLopRule.findFirst({ where: { id, organizationId } });
    if (!existing) throw new Error("Late-coming LOP rule not found");
    const payload = {};
    if (data.lateDays !== undefined) payload.lateDays = Number(data.lateDays);
    if (data.lopDays !== undefined) payload.lopDays = Number(data.lopDays);
    if (data.graceMinutes !== undefined) payload.graceMinutes = Number(data.graceMinutes);
    if (data.isActive !== undefined) payload.isActive = parseBoolean(data.isActive);
    if (data.remarks !== undefined) payload.remarks = String(data.remarks || "").trim() || null;
    if (payload.lateDays !== undefined && (!Number.isInteger(payload.lateDays) || payload.lateDays < 1)) throw new Error("Late days must be a positive whole number");
    if (payload.lopDays !== undefined && (!Number.isFinite(payload.lopDays) || payload.lopDays <= 0 || payload.lopDays > 31)) throw new Error("LOP days must be greater than 0 and no more than 31");
    if (payload.graceMinutes !== undefined && (!Number.isInteger(payload.graceMinutes) || payload.graceMinutes < 0 || payload.graceMinutes > 1440)) throw new Error("Grace time must be between 0 and 1440 minutes");
    const rule = await prisma.lateComingLopRule.update({ where: { id }, data: payload });
    return { ...rule, lopDays: Number(rule.lopDays) };
  }

  async deleteLateComingRule(organizationId, id) {
    const result = await prisma.lateComingLopRule.deleteMany({ where: { id, organizationId } });
    if (!result.count) throw new Error("Late-coming LOP rule not found");
  }
}

module.exports = new PolicyService();
