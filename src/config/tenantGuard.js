const { getTenantId } = require("../utils/tenantContext");

/**
 * Every model with a required `organizationId` column. BillingEvent is left out
 * because its organization is nullable (provider events can arrive before the
 * workspace is resolved) and Organization is the tenant itself.
 */
const TENANT_MODELS = new Set([
  "Subscription", "AttendancePolicy", "LateComingLopRule", "ShiftOverride",
  "CompOffBalance", "OvertimeRequest", "Branch", "Department", "User",
  "SsoLoginCode", "Employee", "Shift", "Attendance", "AttendanceCorrection",
  "LeaveType", "LeaveRequest", "LeaveBalance", "PermissionRequest",
  "CompanyLeave", "Holiday", "SalaryStructure", "Payslip", "PayslipTemplate",
  "SalaryRevision", "Notification", "AuditLog", "EmployeeDevice",
  "OnboardingCandidate", "ExpenseClaim", "EmployeeInvite", "EmployeeDocument",
  "EmployeeExit", "EmployeeClearance", "ExitInterview", "FinalSettlement",
  "Asset", "AssetAssignment", "AssetMaintenance", "ItDeclaration",
  "Form16Record", "StatutoryExport", "BillingOrder", "ChatThread",
  "ChatMessage", "BiometricDevice", "LoanAdvance", "LoanRepayment",
  "AppraisalCycle", "AppraisalReview", "OrgApiKey", "WebhookEndpoint",
  "WebhookDelivery", "Announcement",
]);

const FILTER_OPERATIONS = new Set([
  "findFirst", "findFirstOrThrow", "findMany", "count", "aggregate", "groupBy",
  "updateMany", "updateManyAndReturn", "deleteMany",
]);
const UNIQUE_OPERATIONS = new Set([
  "findUnique", "findUniqueOrThrow", "update", "delete", "upsert",
]);
const CREATE_OPERATIONS = new Set(["create", "createMany", "createManyAndReturn"]);

const violation = (model, operation) => {
  const err = new Error("Cross-tenant data access was blocked.");
  err.statusCode = 404;
  err.code = "TENANT_SCOPE_VIOLATION";
  console.error(`[tenantGuard] blocked ${model}.${operation} outside the caller's organization`);
  return err;
};

const isPlainObject = (value) =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date);

// A literal organizationId that names a different tenant is a bug or an attack.
// Operator filters ({ in: [...] }) are left alone; the AND below still narrows them.
const assertOwnLiteral = (value, tenantId, model, operation) => {
  if (typeof value === "string" && value !== tenantId) throw violation(model, operation);
};

// Compound unique keys such as organizationId_email carry the tenant inside.
const assertCompoundKeys = (where, tenantId, model, operation) => {
  for (const value of Object.values(where)) {
    if (isPlainObject(value) && "organizationId" in value) {
      assertOwnLiteral(value.organizationId, tenantId, model, operation);
    }
  }
};

const assertWriteData = (data, tenantId, model, operation) => {
  if (!isPlainObject(data)) return;
  assertOwnLiteral(data.organizationId, tenantId, model, operation);
  const connected = data.organization?.connect?.id;
  if (connected !== undefined) assertOwnLiteral(connected, tenantId, model, operation);
};

/**
 * Returns the args Prisma should run with, scoped to `tenantId`. Pure so it can
 * be unit tested without a database.
 */
const scopeArgs = (model, operation, args, tenantId) => {
  if (!tenantId || !TENANT_MODELS.has(model)) return args;
  const next = { ...(args || {}) };

  if (FILTER_OPERATIONS.has(operation)) {
    if (next.where) assertOwnLiteral(next.where.organizationId, tenantId, model, operation);
    next.where = next.where
      ? { AND: [next.where, { organizationId: tenantId }] }
      : { organizationId: tenantId };
    if (operation.startsWith("update")) assertWriteData(next.data, tenantId, model, operation);
    return next;
  }

  if (UNIQUE_OPERATIONS.has(operation)) {
    const where = { ...(next.where || {}) };
    assertOwnLiteral(where.organizationId, tenantId, model, operation);
    assertCompoundKeys(where, tenantId, model, operation);
    where.organizationId = tenantId;
    next.where = where;
    if (operation === "update") assertWriteData(next.data, tenantId, model, operation);
    if (operation === "upsert") {
      assertWriteData(next.create, tenantId, model, operation);
      assertWriteData(next.update, tenantId, model, operation);
    }
    return next;
  }

  if (CREATE_OPERATIONS.has(operation)) {
    const rows = Array.isArray(next.data) ? next.data : [next.data];
    rows.forEach((row) => assertWriteData(row, tenantId, model, operation));
    return next;
  }

  return args;
};

/**
 * TENANT_GUARD=off disables the guard as an emergency switch; anything else
 * (including unset) enforces it.
 */
const tenantGuardExtension = {
  name: "tenantGuard",
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        if (String(process.env.TENANT_GUARD || "").toLowerCase() === "off") return query(args);
        return query(scopeArgs(model, operation, args, getTenantId()));
      },
    },
  },
};

module.exports = { TENANT_MODELS, scopeArgs, tenantGuardExtension };
