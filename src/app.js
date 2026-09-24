require("dotenv").config();
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const helmet = require("helmet");
const morgan = require("morgan");

const authRoutes = require("./routes/auth.routes");
const departmentRoutes = require("./routes/department.routes");
const branchRoutes = require("./routes/branch.routes");
const employeeRoutes = require("./routes/employee.routes");
const shiftRoutes = require("./routes/shift.routes");
const attendanceRoutes = require("./routes/attendance.routes");
const correctionRoutes = require("./routes/correction.routes");
const leaveRoutes = require("./routes/leave.routes");
const payrollRoutes = require("./routes/payroll.routes");
const reportRoutes = require("./routes/report.routes");
const notificationRoutes = require("./routes/notification.routes");
const deviceRoutes = require("./routes/device.routes");
const auditRoutes = require("./routes/audit.routes");
const holidayRoutes = require("./routes/holiday.routes");
const onboardingRoutes = require("./routes/onboarding.routes");
const uploadRoutes = require("./routes/upload.routes");
const expenseRoutes = require("./routes/expense.routes");
const policyRoutes = require("./routes/policy.routes");
const compOffRoutes = require("./routes/compoff.routes");
const overtimeRoutes = require("./routes/overtime.routes");
const shiftOverrideRoutes = require("./routes/shiftoverride.routes");
const offboardingRoutes = require("./routes/offboarding.routes");
const assetRoutes = require("./routes/asset.routes");
const statutoryRoutes = require("./routes/statutory.routes");
const billingRoutes = require("./routes/billing.routes");
const chatRoutes = require("./routes/chat.routes");
const biometricRoutes = require("./routes/biometric.routes");
const orgRoutes = require("./routes/org.routes");
const loanRoutes = require("./routes/loan.routes");
const appraisalRoutes = require("./routes/appraisal.routes");
const apikeyRoutes = require("./routes/apikey.routes");
const billingWebhookRoutes = require("./routes/billing.webhook.routes");
const { apiRateLimiter } = require("./middleware/rateLimiter.middleware");
const { auditLogger } = require("./middleware/audit.middleware");

const app = express();

const isProduction = process.env.NODE_ENV === "production";

// Extra origins can be supplied as a comma-separated list without a redeploy.
const configuredOrigins = (process.env.CORS_ALLOWED_ORIGINS || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

const allowedOrigins = [
  process.env.FRONTEND_URL,
  ...configuredOrigins,
].filter(Boolean);

if (!isProduction) {
  allowedOrigins.push(
    "http://localhost:3000",
    "http://localhost:3001",
    "http://localhost:5173",
    "http://localhost:8081",
    "http://127.0.0.1:8081",
  );
}

app.use(helmet());
app.use(
  cors({
    origin: (origin, callback) => {
      // Same-origin and non-browser clients (mobile, curl) send no Origin.
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);

      // Local/LAN origins are convenient during development, but must not
      // bypass the explicit credentialed-origin allowlist in production.
      const isLocalOrLan = /^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+)(:\d+)?$/.test(origin);
      if (!isProduction && isLocalOrLan) return callback(null, true);

      // Outside production any origin is allowed so local tooling and LAN
      // devices can reach the API. In production the allowlist is exact:
      // wildcard suffixes like *.netlify.app let anyone host a credentialed
      // page against this API.
      if (!isProduction) return callback(null, true);

      return callback(null, false);
    },
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization", "x-client-platform", "x-device-id"],
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  })
);
app.use(cookieParser());
app.use("/api/billing/webhook", express.raw({ type: "application/json" }), billingWebhookRoutes);
app.use("/billing/webhook", express.raw({ type: "application/json" }), billingWebhookRoutes);
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true, limit: "5mb" }));
app.use(morgan(isProduction ? "combined" : "dev"));

// Apply general rate limiter to all API routes
app.use("/api", apiRateLimiter);

// Records mutating requests once the response is sent. Registered before the
// routers so it wraps every module, but reads req.user which the per-router
// `authenticate` middleware populates during the request.
app.use(auditLogger);

// API Modules
app.use("/api/auth", authRoutes);
app.use("/api/departments", departmentRoutes);
app.use("/api/branches", branchRoutes);
app.use("/api/employees", employeeRoutes);
app.use("/api/shifts", shiftRoutes);
app.use("/api/attendance/corrections", correctionRoutes);
app.use("/api/attendance/regularization", correctionRoutes);
app.use("/api/attendance/regularizations", correctionRoutes);
// Mobile client posts to /api/corrections/* — the real mount is under attendance.
app.use("/api/corrections", correctionRoutes);
app.use("/api/attendance", attendanceRoutes);
app.use("/api/leaves", leaveRoutes);
app.use("/api/payroll", payrollRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/devices", deviceRoutes);
app.use("/api/audit-logs", auditRoutes);
app.use("/api/holidays", holidayRoutes);
app.use("/api/onboarding", onboardingRoutes);
app.use("/api/upload", uploadRoutes);
app.use("/api/expenses", expenseRoutes);
app.use("/api/policy", policyRoutes);
app.use("/api/compoff", compOffRoutes);
app.use("/api/overtime", overtimeRoutes);
app.use("/api/shift-overrides", shiftOverrideRoutes);
app.use("/api/offboarding", offboardingRoutes);
app.use("/api/assets", assetRoutes);
app.use("/api/payroll", statutoryRoutes);
app.use("/api/billing", billingRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/biometric", biometricRoutes);
app.use("/api/organization", orgRoutes);
app.use("/api/loans", loanRoutes);
app.use("/api/appraisals", appraisalRoutes);
app.use("/api/api-keys", apikeyRoutes);

// Root route aliases (handles clients calling without /api prefix)
app.use("/offboarding", offboardingRoutes);
app.use("/assets", assetRoutes);
app.use("/auth", authRoutes);
app.use("/departments", departmentRoutes);
app.use("/branches", branchRoutes);
app.use("/employees", employeeRoutes);
app.use("/shifts", shiftRoutes);
app.use("/attendance/corrections", correctionRoutes);
app.use("/attendance/regularization", correctionRoutes);
app.use("/attendance/regularizations", correctionRoutes);
app.use("/corrections", correctionRoutes);
app.use("/attendance", attendanceRoutes);
app.use("/leaves", leaveRoutes);
app.use("/payroll", payrollRoutes);
app.use("/payroll", statutoryRoutes);
app.use("/reports", reportRoutes);
app.use("/notifications", notificationRoutes);
app.use("/devices", deviceRoutes);
app.use("/audit-logs", auditRoutes);
app.use("/holidays", holidayRoutes);
app.use("/onboarding", onboardingRoutes);
app.use("/upload", uploadRoutes);
app.use("/expenses", expenseRoutes);
app.use("/policy", policyRoutes);
app.use("/compoff", compOffRoutes);
app.use("/overtime", overtimeRoutes);
app.use("/shift-overrides", shiftOverrideRoutes);
app.use("/billing", billingRoutes);
app.use("/chat", chatRoutes);
app.use("/biometric", biometricRoutes);
app.use("/organization", orgRoutes);
app.use("/loans", loanRoutes);
app.use("/appraisals", appraisalRoutes);
app.use("/api-keys", apikeyRoutes);

app.get(["/", "/api"], (req, res) => {
  res.json({
    success: true,
    message: "WorkPulse Workforce Backend API is running",
    endpoints: {
      health: "/api/health",
      auth: "/api/auth",
      departments: "/api/departments",
      branches: "/api/branches",
      employees: "/api/employees",
      shifts: "/api/shifts",
      attendance: "/api/attendance",
      corrections: "/api/attendance/corrections",
      leaves: "/api/leaves",
      payroll: "/api/payroll",
      billing: "/api/billing",
      chat: "/api/chat",
      biometric: "/api/biometric",
    },
  });
});

app.get(["/health", "/api/health"], (req, res) => {
  res.json({
    success: true,
    message: "Attendance API is running",
  });
});

// Readiness probe. Confirms the database answers without disclosing tenant
// counts or driver error details to anonymous callers.
app.get(["/api/db-status", "/api/ready"], async (req, res) => {
  try {
    const prismaInstance = require("./config/database");
    await prismaInstance.$queryRaw`SELECT 1`;
    res.json({ success: true, database: "connected" });
  } catch (err) {
    console.error("[readiness] database check failed:", err.message);
    res.status(503).json({ success: false, database: "error" });
  }
});

// 404 Not Found Handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Cannot ${req.method} ${req.originalUrl}`,
  });
});

// Global Error Handling Middleware
app.use((err, req, res, next) => {
  console.error("Unhandled Error:", err);

  if (err && err.message === "Not allowed by CORS") {
    return res.status(403).json({ success: false, message: "Origin not allowed" });
  }

  const statusCode = err.statusCode || 500;

  // Internal failures must not leak driver or stack detail to clients.
  const message =
    statusCode >= 500 && isProduction
      ? "Internal Server Error"
      : err.message || "Internal Server Error";

  res.status(statusCode).json({
    success: false,
    message,
    ...(process.env.NODE_ENV === "development" && { stack: err.stack }),
  });
});

module.exports = app;
