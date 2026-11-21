const prisma = require("../config/database");
const { boundedNumber, normalizeWeeklyOffDays, workingDaysFromWeeklyOff } = require("../utils/policyValidation");
const { policySelect } = require("../utils/prismaSelects");
const { normalizeCycleDay, normalizeDayBasis } = require("../utils/payrollCycle");

const DEFAULT_POLICY = {
  workingDaysPerMonth: 26,
  probationMonths: 3,
  monthlyPaidLeaveDays: 1,
  paidLeaveCarryForward: true,
  monthlyPermissionHours: 3,
  permissionRequiresProbation: true,
  payrollCycleStartDay: 1,
  payrollCycleEndDay: 31,
  payrollDayBasis: "ACTUAL_DAYS",
  halfDayThresholdMinutes: 240,
  maxLatesBeforeDeduction: 3,
  lateDeductionPercent: 0.25,
  breakDeductionEnabled: false,
  lunchDeductionEnabled: false,
  breakGraceMinutes: 0,
  lunchGraceMinutes: 0,
  pauseDeductionSalaryBasis: "BASE_SALARY",
  breakDeductionMethod: "HOURLY_RATE",
  lunchDeductionMethod: "HOURLY_RATE",
  breakFixedPerMinute: 0,
  lunchFixedPerMinute: 0,
  maxPauseDeductionPerDay: 0,
  allowWfh: true,
  requireOtApproval: false,
  geofenceStrict: false,
  requireTrustedDevice: false,
  deviceVerificationEnabled: true,
  deviceConflictAlertEnabled: true,
  deviceConflictAutoBlock: false,
  allowSharedKioskDevice: false,
  shootRecoveryEnabled: true,
  shootRecoveryThresholdMinutes: 720,
  shootTravelOtEnabled: true,
  shootTravelOtThresholdMinutes: 360,
  shootTravelOtMultiplier: 0.5,
  shootOtMultiplier: 1.5,
  shootOtSalaryBasis: "BASE_SALARY",
  weeklyOffDays: "0",
};

// Older production branches may not have the optional shoot-policy columns yet.
// Keep the core policy pages readable while the additive migration is deployed.
const LEGACY_POLICY_SELECT = {
  id: true,
  organizationId: true,
  workingDaysPerMonth: true,
  probationMonths: true,
  // New paid-leave fields are omitted here so old branches can still be read
  // until the additive migration has been deployed.
  monthlyPermissionHours: true,
  permissionRequiresProbation: true,
  payrollCycleStartDay: true,
  payrollCycleEndDay: true,
  payrollDayBasis: true,
  halfDayThresholdMinutes: true,
  maxLatesBeforeDeduction: true,
  lateDeductionPercent: true,
  allowWfh: true,
  requireOtApproval: true,
  geofenceStrict: true,
  weeklyOffDays: true,
  createdAt: true,
  updatedAt: true,
};

const normalizePolicy = (policy, organizationId, isDefault = false) => ({
  ...(policy || {}),
  organizationId,
  lateDeductionPercent: Number(policy?.lateDeductionPercent ?? DEFAULT_POLICY.lateDeductionPercent),
  breakDeductionEnabled: Boolean(policy?.breakDeductionEnabled ?? DEFAULT_POLICY.breakDeductionEnabled),
  lunchDeductionEnabled: Boolean(policy?.lunchDeductionEnabled ?? DEFAULT_POLICY.lunchDeductionEnabled),
  breakGraceMinutes: Number(policy?.breakGraceMinutes ?? DEFAULT_POLICY.breakGraceMinutes),
  lunchGraceMinutes: Number(policy?.lunchGraceMinutes ?? DEFAULT_POLICY.lunchGraceMinutes),
  pauseDeductionSalaryBasis: String(policy?.pauseDeductionSalaryBasis ?? DEFAULT_POLICY.pauseDeductionSalaryBasis),
  breakDeductionMethod: String(policy?.breakDeductionMethod ?? DEFAULT_POLICY.breakDeductionMethod),
  lunchDeductionMethod: String(policy?.lunchDeductionMethod ?? DEFAULT_POLICY.lunchDeductionMethod),
  breakFixedPerMinute: Number(policy?.breakFixedPerMinute ?? DEFAULT_POLICY.breakFixedPerMinute),
  lunchFixedPerMinute: Number(policy?.lunchFixedPerMinute ?? DEFAULT_POLICY.lunchFixedPerMinute),
  maxPauseDeductionPerDay: Number(policy?.maxPauseDeductionPerDay ?? DEFAULT_POLICY.maxPauseDeductionPerDay),
  monthlyPaidLeaveDays: Number(policy?.monthlyPaidLeaveDays ?? DEFAULT_POLICY.monthlyPaidLeaveDays),
  paidLeaveCarryForward: Boolean(policy?.paidLeaveCarryForward ?? DEFAULT_POLICY.paidLeaveCarryForward),
  monthlyPermissionHours: Number(policy?.monthlyPermissionHours ?? DEFAULT_POLICY.monthlyPermissionHours),
  leaveEligibilityActive: Boolean(policy?.permissionRequiresProbation ?? true),
  shootRecoveryEnabled: Boolean(policy?.shootRecoveryEnabled ?? DEFAULT_POLICY.shootRecoveryEnabled),
  shootRecoveryThresholdMinutes: Number(policy?.shootRecoveryThresholdMinutes ?? DEFAULT_POLICY.shootRecoveryThresholdMinutes),
  shootTravelOtEnabled: Boolean(policy?.shootTravelOtEnabled ?? DEFAULT_POLICY.shootTravelOtEnabled),
  shootTravelOtThresholdMinutes: Number(policy?.shootTravelOtThresholdMinutes ?? DEFAULT_POLICY.shootTravelOtThresholdMinutes),
  shootTravelOtMultiplier: Number(policy?.shootTravelOtMultiplier ?? DEFAULT_POLICY.shootTravelOtMultiplier),
  shootOtMultiplier: Number(policy?.shootOtMultiplier ?? DEFAULT_POLICY.shootOtMultiplier),
  shootOtSalaryBasis: String(policy?.shootOtSalaryBasis ?? DEFAULT_POLICY.shootOtSalaryBasis),
  isDefault,
});

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
    let policy;
    try {
      policy = await prisma.attendancePolicy.findUnique({ where: { organizationId }, select: policySelect });
    } catch (error) {
      if (error?.code !== "P2022") throw error;
      policy = await prisma.attendancePolicy.findUnique({ where: { organizationId }, select: LEGACY_POLICY_SELECT });
      return policy ? normalizePolicy(policy, organizationId) : normalizePolicy(DEFAULT_POLICY, organizationId, true);
    }

    if (!policy) {
      return normalizePolicy(DEFAULT_POLICY, organizationId, true);
    }

    return normalizePolicy(policy, organizationId);
  }


  /**
   * Upsert org attendance policy
   */
  async upsertPolicy(organizationId, data) {
    const {
      workingDaysPerMonth,
      probationMonths,
      monthlyPaidLeaveDays,
      paidLeaveCarryForward,
      monthlyPermissionHours,
      permissionRequiresProbation,
      leaveEligibilityActive,
      payrollCycleStartDay,
      payrollCycleEndDay,
      payrollDayBasis,
      halfDayThresholdMinutes,
      maxLatesBeforeDeduction,
      lateDeductionPercent,
      breakDeductionEnabled,
      lunchDeductionEnabled,
      breakGraceMinutes,
      lunchGraceMinutes,
      pauseDeductionSalaryBasis,
      breakDeductionMethod,
      lunchDeductionMethod,
      breakFixedPerMinute,
      lunchFixedPerMinute,
      maxPauseDeductionPerDay,
      allowWfh,
      requireOtApproval,
      geofenceStrict,
      requireTrustedDevice,
      deviceVerificationEnabled,
      deviceConflictAlertEnabled,
      deviceConflictAutoBlock,
      allowSharedKioskDevice,
      shootRecoveryEnabled,
      shootRecoveryThresholdMinutes,
      shootTravelOtEnabled,
      shootTravelOtThresholdMinutes,
      shootTravelOtMultiplier,
      shootOtMultiplier,
      shootOtSalaryBasis,
      weeklyOffDays,
    } = data;

    const payload = {};
    if (workingDaysPerMonth !== undefined) payload.workingDaysPerMonth = boundedNumber("Working days per month", workingDaysPerMonth, { min: 1, max: 31, integer: true });
    if (probationMonths !== undefined) payload.probationMonths = boundedNumber("Probation months", probationMonths, { min: 0, max: 36, integer: true });
    if (monthlyPaidLeaveDays !== undefined) payload.monthlyPaidLeaveDays = boundedNumber("Monthly paid leave days", monthlyPaidLeaveDays, { min: 0, max: 31 });
    if (paidLeaveCarryForward !== undefined) payload.paidLeaveCarryForward = parseBoolean(paidLeaveCarryForward);
    if (monthlyPermissionHours !== undefined) payload.monthlyPermissionHours = boundedNumber("Monthly permission hours", monthlyPermissionHours, { min: 0, max: 100 });
    if (permissionRequiresProbation !== undefined) payload.permissionRequiresProbation = parseBoolean(permissionRequiresProbation);
    if (leaveEligibilityActive !== undefined) payload.permissionRequiresProbation = parseBoolean(leaveEligibilityActive);
    if (payrollCycleStartDay !== undefined) payload.payrollCycleStartDay = normalizeCycleDay(payrollCycleStartDay, DEFAULT_POLICY.payrollCycleStartDay);
    if (payrollCycleEndDay !== undefined) payload.payrollCycleEndDay = normalizeCycleDay(payrollCycleEndDay, DEFAULT_POLICY.payrollCycleEndDay);
    if (payrollDayBasis !== undefined) payload.payrollDayBasis = normalizeDayBasis(payrollDayBasis, DEFAULT_POLICY.payrollDayBasis);
    if (halfDayThresholdMinutes !== undefined) payload.halfDayThresholdMinutes = boundedNumber("Half-day threshold", halfDayThresholdMinutes, { min: 0, max: 1440, integer: true });
    if (maxLatesBeforeDeduction !== undefined) payload.maxLatesBeforeDeduction = boundedNumber("Lates before deduction", maxLatesBeforeDeduction, { min: 0, max: 31, integer: true });
    if (lateDeductionPercent !== undefined) payload.lateDeductionPercent = boundedNumber("Late deduction (fraction of daily rate)", lateDeductionPercent, { min: 0, max: 1 });
    if (breakDeductionEnabled !== undefined) payload.breakDeductionEnabled = parseBoolean(breakDeductionEnabled);
    if (lunchDeductionEnabled !== undefined) payload.lunchDeductionEnabled = parseBoolean(lunchDeductionEnabled);
    if (breakGraceMinutes !== undefined) payload.breakGraceMinutes = boundedNumber("Break grace minutes", breakGraceMinutes, { min: 0, max: 1440, integer: true });
    if (lunchGraceMinutes !== undefined) payload.lunchGraceMinutes = boundedNumber("Lunch grace minutes", lunchGraceMinutes, { min: 0, max: 1440, integer: true });
    if (pauseDeductionSalaryBasis !== undefined) payload.pauseDeductionSalaryBasis = ["BASE_SALARY", "GROSS_SALARY", "MONTHLY_CTC"].includes(String(pauseDeductionSalaryBasis)) ? String(pauseDeductionSalaryBasis) : DEFAULT_POLICY.pauseDeductionSalaryBasis;
    if (breakDeductionMethod !== undefined) payload.breakDeductionMethod = ["HOURLY_RATE", "FIXED_PER_MINUTE"].includes(String(breakDeductionMethod)) ? String(breakDeductionMethod) : DEFAULT_POLICY.breakDeductionMethod;
    if (lunchDeductionMethod !== undefined) payload.lunchDeductionMethod = ["HOURLY_RATE", "FIXED_PER_MINUTE"].includes(String(lunchDeductionMethod)) ? String(lunchDeductionMethod) : DEFAULT_POLICY.lunchDeductionMethod;
    if (breakFixedPerMinute !== undefined) payload.breakFixedPerMinute = boundedNumber("Fixed break deduction per minute", breakFixedPerMinute, { min: 0, max: 100000 });
    if (lunchFixedPerMinute !== undefined) payload.lunchFixedPerMinute = boundedNumber("Fixed lunch deduction per minute", lunchFixedPerMinute, { min: 0, max: 100000 });
    if (maxPauseDeductionPerDay !== undefined) payload.maxPauseDeductionPerDay = boundedNumber("Maximum pause deduction per day", maxPauseDeductionPerDay, { min: 0, max: 100000 });
    if (allowWfh !== undefined) payload.allowWfh = parseBoolean(allowWfh);
    if (requireOtApproval !== undefined) payload.requireOtApproval = parseBoolean(requireOtApproval);
    if (geofenceStrict !== undefined) payload.geofenceStrict = parseBoolean(geofenceStrict);
    if (requireTrustedDevice !== undefined) payload.requireTrustedDevice = parseBoolean(requireTrustedDevice);
    if (deviceVerificationEnabled !== undefined) payload.deviceVerificationEnabled = parseBoolean(deviceVerificationEnabled);
    if (deviceConflictAlertEnabled !== undefined) payload.deviceConflictAlertEnabled = parseBoolean(deviceConflictAlertEnabled);
    if (deviceConflictAutoBlock !== undefined) payload.deviceConflictAutoBlock = parseBoolean(deviceConflictAutoBlock);
    if (allowSharedKioskDevice !== undefined) payload.allowSharedKioskDevice = parseBoolean(allowSharedKioskDevice);
    if (shootRecoveryEnabled !== undefined) payload.shootRecoveryEnabled = parseBoolean(shootRecoveryEnabled);
    if (shootRecoveryThresholdMinutes !== undefined) payload.shootRecoveryThresholdMinutes = boundedNumber("Shoot recovery threshold", shootRecoveryThresholdMinutes, { min: 1, max: 2880, integer: true });
    if (shootTravelOtEnabled !== undefined) payload.shootTravelOtEnabled = parseBoolean(shootTravelOtEnabled);
    if (shootTravelOtThresholdMinutes !== undefined) payload.shootTravelOtThresholdMinutes = boundedNumber("Travel OT threshold", shootTravelOtThresholdMinutes, { min: 1, max: 2880, integer: true });
    if (shootTravelOtMultiplier !== undefined) payload.shootTravelOtMultiplier = boundedNumber("Travel overtime multiplier", shootTravelOtMultiplier, { min: 0, max: 5 });
    if (shootOtMultiplier !== undefined) payload.shootOtMultiplier = boundedNumber("Shoot overtime multiplier", shootOtMultiplier, { min: 0, max: 5 });
    if (shootOtSalaryBasis !== undefined) payload.shootOtSalaryBasis = ["BASE_SALARY", "MONTHLY_CTC"].includes(String(shootOtSalaryBasis)) ? String(shootOtSalaryBasis) : DEFAULT_POLICY.shootOtSalaryBasis;
    if (weeklyOffDays !== undefined) payload.weeklyOffDays = normalizeWeeklyOffDays(weeklyOffDays);

    // Pause deductions are a payroll entitlement. Existing plan records expose
    // the single source of truth for whether payroll is active in this tenant.
    if ((payload.breakDeductionEnabled || payload.lunchDeductionEnabled)) {
      const organization = await prisma.organization.findUnique({
        where: { id: organizationId },
        select: { subscription: { select: { hasPayroll: true } } },
      });
      if (organization?.subscription && organization.subscription.hasPayroll === false) {
        const error = new Error("Extra break/lunch salary deductions require a Payroll-enabled plan.");
        error.statusCode = 402;
        throw error;
      }
    }
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
      try {
        policy = await save();
      } catch (error) {
        if (error?.code !== "P2022") throw error;
        const legacyPayload = { ...payload };
        delete legacyPayload.shootRecoveryEnabled;
        delete legacyPayload.shootRecoveryThresholdMinutes;
        delete legacyPayload.shootTravelOtEnabled;
        delete legacyPayload.shootTravelOtThresholdMinutes;
        delete legacyPayload.shootTravelOtMultiplier;
        delete legacyPayload.shootOtMultiplier;
        delete legacyPayload.shootOtSalaryBasis;
        delete legacyPayload.breakDeductionEnabled;
        delete legacyPayload.lunchDeductionEnabled;
        delete legacyPayload.breakGraceMinutes;
        delete legacyPayload.lunchGraceMinutes;
        delete legacyPayload.pauseDeductionSalaryBasis;
        delete legacyPayload.breakDeductionMethod;
        delete legacyPayload.lunchDeductionMethod;
        delete legacyPayload.breakFixedPerMinute;
        delete legacyPayload.lunchFixedPerMinute;
        delete legacyPayload.maxPauseDeductionPerDay;
        policy = await prisma.attendancePolicy.upsert({
          where: { organizationId },
          update: legacyPayload,
          create: { organizationId, ...legacyPayload },
          select: LEGACY_POLICY_SELECT,
        });
        return normalizePolicy(policy, organizationId);
      }
    }

    return { ...normalizePolicy(policy, organizationId), ...(payload.weeklyOffDays !== undefined ? { shiftsUpdated } : {}) };
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
