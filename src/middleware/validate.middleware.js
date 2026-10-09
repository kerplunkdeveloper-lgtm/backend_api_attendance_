const { z } = require("zod");

const EMAIL = z.string().trim().email().max(254).toLowerCase();
const UUID = z.string().uuid();
const PASSWORD = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(128)
  .refine((v) => /[a-zA-Z]/.test(v) && /[0-9]/.test(v), {
    message: "Password must contain at least one letter and one number",
  });

const LATITUDE = z.coerce.number().finite().min(-90).max(90);
const LONGITUDE = z.coerce.number().finite().min(-180).max(180);
// No upper bound: laptops without GPS locate by IP/Wi-Fi and report accuracy of
// 100+ km. That is a weak fix, not an invalid request — the geofence decides.
const ACCURACY = z.coerce.number().finite().nonnegative();
const ISO_TIMESTAMP = z.string().datetime({ offset: true });

const FIELD_LABELS = {
  latitude: "location",
  longitude: "location",
  accuracy: "location accuracy",
  timestamp: "punch time",
  employeeId: "employee",
  workMode: "work mode",
  note: "note",
  wfhNote: "note",
  locationLabel: "location name",
  deviceId: "device",
  email: "email",
  password: "password",
  newPassword: "new password",
  reason: "reason",
  startDate: "start date",
  endDate: "end date",
};

// Zod's built-in messages ("Too big: expected number to be <=100000") are for
// developers. Schema-specific messages are kept; built-in ones are rewritten.
const BUILT_IN_MESSAGE = /^(Too big|Too small|Invalid input|Invalid (string|number|option|ISO|UUID|email)|Unrecognized key)/i;

const friendlyMessage = (issue) => {
  if (!BUILT_IN_MESSAGE.test(issue.message)) return issue.message;
  const field = String(issue.path[issue.path.length - 1] ?? "");
  const label = FIELD_LABELS[field] || field.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase() || "request";

  if (field === "latitude" || field === "longitude") {
    return "We couldn't read your location. Refresh the page and try again.";
  }
  if (field === "timestamp") {
    return "The punch time looks wrong. Check that your device clock is correct and try again.";
  }
  switch (issue.code) {
    case "too_big":
      return issue.origin === "string" ? `The ${label} is too long.` : `The ${label} value is too large.`;
    case "too_small":
      return issue.origin === "string" ? `Please enter a ${label}.` : `The ${label} value is too small.`;
    case "invalid_type":
      // Zod v4 omits the input from issues by default; the message names what it received.
      return /received undefined/.test(issue.message) ? `Please provide a ${label}.` : `The ${label} is not valid.`;
    case "unrecognized_keys":
      return "Something went wrong with this request. Refresh the page and try again.";
    default:
      return `The ${label} is not valid.`;
  }
};

/**
 * Validates one of `body`, `query` or `params` against a Zod schema.
 * On failure the request is rejected before it reaches the controller.
 */
const validate =
  (schema, source = "body") =>
  (req, res, next) => {
    const parsed = schema.safeParse(req[source] ?? {});
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => ({
        path: i.path.join("."),
        message: friendlyMessage(i),
      }));
      return res.status(400).json({
        success: false,
        message: issues[0]?.message || "Invalid request",
        errors: issues,
      });
    }
    req[source] = parsed.data;
    return next();
  };

const schemas = {
  register: z
    .object({
      email: EMAIL,
      password: PASSWORD,
      organizationName: z.string().trim().min(2).max(120).optional(),
      firstName: z.string().trim().min(1).max(80).optional(),
      lastName: z.string().trim().max(80).optional(),
      employeeCode: z.string().trim().max(40).optional(),
      subscriptionPlan: z.string().trim().max(40).optional(),
      billingCycle: z.enum(["MONTHLY", "ANNUAL"]).optional(),
      client: z.enum(["web", "mobile"]).optional(),
    })
    .strict(),

  login: z
    .object({
      email: z
        .union([
          EMAIL,
          z.string().trim().min(1).max(40).regex(/^[^@\s]+$/),
        ])
        .optional(),
      employeeCode: z.string().trim().min(1).max(40).optional(),
      password: z.string().min(1).max(128),
      client: z.enum(["web", "mobile"]).optional(),
    })
    .refine((v) => Boolean(v.email || v.employeeCode), {
      message: "Email or employeeCode is required",
    }),

  googleLogin: z
    .object({
      idToken: z.string().min(20).max(10000),
      client: z.enum(["web", "mobile"]).optional(),
    })
    .strict(),

  sessionMutation: z
    .object({
      refreshToken: z.string().min(20).max(4000).optional(),
      client: z.enum(["web", "mobile"]).optional(),
    })
    .strict(),

  forgotPassword: z.object({ email: EMAIL }).strict(),

  resetPassword: z
    .object({
      token: z.string().min(10).max(2000),
      newPassword: PASSWORD,
    })
    .strict(),

  changePassword: z
    .object({
      currentPassword: z.string().min(1).max(128).optional(),
      newPassword: PASSWORD,
    })
    .strict(),

  activatePlan: z
    .object({
      unlockCode: z.string().trim().min(4).max(80),
    })
    .strict(),

  billingCheckout: z
    .object({
      plan: z.enum(["STARTER", "PROFESSIONAL", "ENTERPRISE"]),
      billingCycle: z.enum(["MONTHLY", "ANNUAL"]).default("MONTHLY"),
      couponCode: z.string().trim().max(40).optional(),
      idempotencyKey: z.string().trim().min(8).max(120).regex(/^[a-zA-Z0-9._:-]+$/).optional(),
    })
    .strict(),

  billingVerify: z
    .object({
      razorpay_order_id: z.string().trim().min(5).max(100),
      razorpay_payment_id: z.string().trim().min(5).max(100),
      razorpay_signature: z.string().trim().length(64).regex(/^[a-f0-9]+$/i),
    })
    .strict(),

  billingPlanPrice: z
    .object({
      priceInr: z.coerce.number().int().min(0).max(100000000),
      isActive: z.boolean().optional(),
    })
    .strict(),

  billingOfferCreate: z
    .object({
      code: z.string().trim().min(3).max(40).regex(/^[a-zA-Z0-9_-]+$/),
      label: z.string().trim().min(1).max(160),
      type: z.enum(["PERCENTAGE", "FIXED"]),
      value: z.coerce.number().nonnegative(),
      maxDiscountInr: z.coerce.number().nonnegative().nullable().optional(),
      eligiblePlans: z.array(z.enum(["STARTER", "PROFESSIONAL", "ENTERPRISE"])).optional(),
      eligibleCycles: z.array(z.enum(["MONTHLY", "ANNUAL"])).optional(),
      firstPaidOrderOnly: z.boolean().optional(),
      isActive: z.boolean().optional(),
      startsAt: z.string().datetime({ offset: true }).nullable().optional(),
      expiresAt: z.string().datetime({ offset: true }).nullable().optional(),
    })
    .strict(),

  billingOfferUpdate: z
    .object({
      code: z.string().trim().min(3).max(40).regex(/^[a-zA-Z0-9_-]+$/).optional(),
      label: z.string().trim().min(1).max(160).optional(),
      type: z.enum(["PERCENTAGE", "FIXED"]).optional(),
      value: z.coerce.number().nonnegative().optional(),
      maxDiscountInr: z.coerce.number().nonnegative().nullable().optional(),
      eligiblePlans: z.array(z.enum(["STARTER", "PROFESSIONAL", "ENTERPRISE"])).optional(),
      eligibleCycles: z.array(z.enum(["MONTHLY", "ANNUAL"])).optional(),
      firstPaidOrderOnly: z.boolean().optional(),
      isActive: z.boolean().optional(),
      startsAt: z.string().datetime({ offset: true }).nullable().optional(),
      expiresAt: z.string().datetime({ offset: true }).nullable().optional(),
    })
    .strict(),

  checkIn: z
    .object({
      latitude: LATITUDE.optional(),
      longitude: LONGITUDE.optional(),
      accuracy: ACCURACY.optional(),
      timestamp: ISO_TIMESTAMP.optional(),
      employeeId: UUID.optional(),
      workMode: z.string().trim().max(40).optional(),
      note: z.string().trim().max(500).optional(),
      wfhNote: z.string().trim().max(500).optional(),
      locationLabel: z.string().trim().max(180).optional(),
      deviceId: z.string().trim().min(4).max(200).optional(),
    })
    .strict(),

  applyLeave: z
    .object({
      leaveTypeId: UUID,
      startDate: z.string().min(8).max(32),
      endDate: z.string().min(8).max(32),
      reason: z.string().trim().min(3).max(1000),
      totalDays: z.coerce.number().positive().max(366).optional(),
      employeeId: UUID.optional(),
    })
    .strict(),

  reviewRequest: z
    .object({
      status: z.enum(["APPROVED", "REJECTED"]),
      reviewNote: z.string().trim().max(1000).optional(),
      reviewerNote: z.string().trim().max(1000).optional(),
      approvedMinutes: z.coerce
        .number()
        .int()
        .min(0)
        .max(24 * 60)
        .optional(),
    })
    .strict(),
};

module.exports = {
  z,
  validate,
  schemas,
  friendlyMessage,
};
