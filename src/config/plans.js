/**
 * Single source of plan metadata. Auth, billing and quota checks must all
 * read from here so ENTERPRISE limits cannot drift between modules.
 */
const PLAN_INR = {
  STARTER: { MONTHLY: 2499, ANNUAL: 24990 },
  PROFESSIONAL: { MONTHLY: 6999, ANNUAL: 69990 },
  ENTERPRISE: { MONTHLY: 16999, ANNUAL: 169990 },
};

const PLAN_CONFIGS = {
  FREE_TRIAL: {
    plan: "FREE_TRIAL",
    status: "TRIALING",
    price: 0,
    maxEmployees: 10,
    maxBranches: 1,
    trialDays: 14,
    hasGeofence: true,
    hasPayroll: true,
    hasShiftPlanner: true,
    hasApiAccess: false,
  },
  STARTER: {
    plan: "STARTER",
    status: "ACTIVE",
    price: PLAN_INR.STARTER.MONTHLY,
    maxEmployees: 25,
    maxBranches: 2,
    periodDays: 30,
    hasGeofence: true,
    hasPayroll: true,
    hasShiftPlanner: true,
    hasApiAccess: false,
  },
  PROFESSIONAL: {
    plan: "PROFESSIONAL",
    status: "ACTIVE",
    price: PLAN_INR.PROFESSIONAL.MONTHLY,
    maxEmployees: 100,
    maxBranches: 10,
    periodDays: 30,
    hasGeofence: true,
    hasPayroll: true,
    hasShiftPlanner: true,
    hasApiAccess: true,
  },
  ENTERPRISE: {
    plan: "ENTERPRISE",
    status: "ACTIVE",
    price: PLAN_INR.ENTERPRISE.MONTHLY,
    maxEmployees: 10000,
    maxBranches: 100,
    periodDays: 30,
    hasGeofence: true,
    hasPayroll: true,
    hasShiftPlanner: true,
    hasApiAccess: true,
  },
};

const SUBSCRIPTION_PLANS = [
  {
    id: "FREE_TRIAL",
    name: "Free Trial",
    badge: "14-Day Free Trial",
    priceMonthly: 0,
    priceAnnual: 0,
    currency: "INR",
    maxEmployees: PLAN_CONFIGS.FREE_TRIAL.maxEmployees,
    maxBranches: PLAN_CONFIGS.FREE_TRIAL.maxBranches,
    description: "Full access to try WorkPulse with your core team for 14 days.",
    features: [
      "Up to 10 Employees",
      "1 Branch Location",
      "GPS Geofenced Punching",
      "Live Attendance Tracking",
      "Leave Management",
      "Standard Shift Schedules",
      "Community Support",
    ],
    popular: false,
  },
  {
    id: "STARTER",
    name: "Starter",
    badge: "For Growing Teams",
    priceMonthly: PLAN_INR.STARTER.MONTHLY,
    priceAnnual: PLAN_INR.STARTER.ANNUAL,
    currency: "INR",
    maxEmployees: PLAN_CONFIGS.STARTER.maxEmployees,
    maxBranches: PLAN_CONFIGS.STARTER.maxBranches,
    description: "Essential attendance, geofencing, and leave management for small businesses.",
    features: [
      "Up to 25 Employees",
      "2 Branch Locations",
      "GPS Geofencing & Anti-Spoof",
      "Leave & Holiday Management",
      "Miss-Punch Regularization",
      "Basic Payslip Generation",
      "Email Support",
    ],
    popular: false,
  },
  {
    id: "PROFESSIONAL",
    name: "Professional",
    badge: "Most Popular",
    priceMonthly: PLAN_INR.PROFESSIONAL.MONTHLY,
    priceAnnual: PLAN_INR.PROFESSIONAL.ANNUAL,
    currency: "INR",
    maxEmployees: PLAN_CONFIGS.PROFESSIONAL.maxEmployees,
    maxBranches: PLAN_CONFIGS.PROFESSIONAL.maxBranches,
    description: "Complete workforce platform with shift overrides, comp-off, overtime, and payroll.",
    features: [
      "Up to 100 Employees",
      "10 Branch Locations",
      "Shift Scheduling & Day Overrides",
      "Overtime Approval Gateways",
      "Comp-Off Balance Ledger",
      "Full Automated Payroll Engine",
      "Device Binding & Geofence Bypass Audit",
      "Priority 24/7 Support",
    ],
    popular: true,
  },
  {
    id: "ENTERPRISE",
    name: "Enterprise",
    badge: "For Large Organizations",
    priceMonthly: PLAN_INR.ENTERPRISE.MONTHLY,
    priceAnnual: PLAN_INR.ENTERPRISE.ANNUAL,
    currency: "INR",
    maxEmployees: PLAN_CONFIGS.ENTERPRISE.maxEmployees,
    maxBranches: PLAN_CONFIGS.ENTERPRISE.maxBranches,
    description: "High-volume workspaces, biometric hardware, and REST API access.",
    features: [
      "Up to 10,000 Employees",
      "Up to 100 Branch Locations",
      "Custom Org Policy Engine",
      "Biometric Hardware Integration",
      "Dedicated REST API Access",
      "Custom RBAC Roles & Permissions",
      "Dedicated Account Manager",
      "99.9% Uptime SLA",
    ],
    popular: false,
  },
];

const PAID_PLANS = new Set(["STARTER", "PROFESSIONAL", "ENTERPRISE"]);
const SEAT_STATUSES = ["ACTIVE", "PROBATION", "NOTICE_PERIOD"];
const DEFAULT_API_KEY_SCOPES = [
  "read:employees",
  "read:attendance",
  "read:reports",
  "read:payroll",
  "write:attendance",
];

const getPlan = (name) => PLAN_CONFIGS[String(name || "").toUpperCase()] || null;

const isPaidPlan = (name) => PAID_PLANS.has(String(name || "").toUpperCase());

const addBillingPeriod = (from, billingCycle) => {
  const start = new Date(from);
  const end = new Date(start.getTime());
  const months = String(billingCycle).toUpperCase() === "ANNUAL" ? 12 : 1;
  end.setUTCMonth(end.getUTCMonth() + months);
  return end;
};

module.exports = {
  PLAN_INR,
  PLAN_CONFIGS,
  PLAN_LIMITS: Object.fromEntries(
    Object.entries(PLAN_CONFIGS).map(([key, value]) => [
      key,
      { maxEmployees: value.maxEmployees, maxBranches: value.maxBranches },
    ]),
  ),
  SUBSCRIPTION_PLANS,
  PAID_PLANS,
  SEAT_STATUSES,
  DEFAULT_API_KEY_SCOPES,
  getPlan,
  isPaidPlan,
  addBillingPeriod,
};
