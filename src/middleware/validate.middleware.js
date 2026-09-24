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

const COORDINATE = z.coerce.number().finite();

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
        message: i.message,
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
    })
    .strict(),

  login: z
    .object({
      email: EMAIL.optional(),
      employeeCode: z.string().trim().min(1).max(40).optional(),
      password: z.string().min(1).max(128),
      client: z.enum(["web", "mobile"]).optional(),
    })
    .refine((v) => Boolean(v.email || v.employeeCode), {
      message: "Email or employeeCode is required",
    }),

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

  checkIn: z
    .object({
      latitude: COORDINATE.optional(),
      longitude: COORDINATE.optional(),
      accuracy: COORDINATE.optional(),
      timestamp: z.string().min(10).max(40).optional(),
      employeeId: UUID.optional(),
      workMode: z.string().trim().max(40).optional(),
      note: z.string().trim().max(500).optional(),
      wfhNote: z.string().trim().max(500).optional(),
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
};
