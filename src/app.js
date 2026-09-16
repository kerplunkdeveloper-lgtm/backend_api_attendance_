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
const { authRateLimiter, apiRateLimiter } = require("./middleware/rateLimiter.middleware");

const app = express();

const allowedOrigins = [
  process.env.FRONTEND_URL,
  "http://localhost:3000",
  "http://localhost:3001",
  "http://localhost:5173",
  "https://papayawhip-parrot-520523.hostingersite.com",
  "https://chipper-babka-a4b9e2.netlify.app",
  "https://workpl.netlify.app",
].filter(Boolean);

app.use(helmet());
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (
        allowedOrigins.includes(origin) ||
        process.env.NODE_ENV !== "production" ||
        origin.endsWith(".hostingersite.com") ||
        origin.endsWith(".netlify.app") ||
        origin.endsWith(".vercel.app")
      ) {
        return callback(null, true);
      }
      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  })
);
app.use(cookieParser());
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true, limit: "25mb" }));
app.use(morgan("dev"));

// Apply general rate limiter to all API routes
app.use("/api", apiRateLimiter);

// API Modules
app.use("/api/auth", authRoutes);
app.use("/api/departments", departmentRoutes);
app.use("/api/branches", branchRoutes);
app.use("/api/employees", employeeRoutes);
app.use("/api/shifts", shiftRoutes);
app.use("/api/attendance/corrections", correctionRoutes);
app.use("/api/attendance/regularization", correctionRoutes);
app.use("/api/attendance/regularizations", correctionRoutes);
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

app.get("/", (req, res) => {
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
    },
  });
});

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "Attendance API is running",
  });
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
  const statusCode = err.statusCode || 500;
  res.status(statusCode).json({
    success: false,
    message: err.message || "Internal Server Error",
    ...(process.env.NODE_ENV === "development" && { stack: err.stack }),
  });
});

module.exports = app;