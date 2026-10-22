/**
 * Creates the WorkPulse platform owner (SUPER_ADMIN) in its own workspace.
 *
 *   node scripts/create-platform-owner.js owner@yourcompany.com
 *
 * Prints a one-time password; the account must change it at first sign-in.
 * The workspace holds only this account, so it never appears as a client.
 */
require("dotenv").config();
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const prisma = require("../src/config/database");

(async () => {
  const email = String(process.argv[2] || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    console.error("Usage: node scripts/create-platform-owner.js owner@yourcompany.com");
    process.exit(1);
  }

  const existing = await prisma.user.findFirst({ where: { role: "SUPER_ADMIN" }, select: { email: true } });
  if (existing) {
    console.error(`A platform owner already exists (${existing.email}). Nothing was changed.`);
    process.exit(1);
  }
  const clash = await prisma.user.findFirst({ where: { email: { equals: email, mode: "insensitive" } }, select: { id: true } });
  if (clash) {
    console.error("That email is already used by another account. Use a different one.");
    process.exit(1);
  }

  const password = `WP-${crypto.randomBytes(9).toString("base64url")}`;
  const passwordHash = await bcrypt.hash(password, 12);

  const org = await prisma.organization.create({
    data: {
      name: "WorkPulse Platform",
      email,
      subscriptionPlan: "ENTERPRISE",
      subscriptionStatus: "ACTIVE",
      planLocked: false,
      maxEmployees: 5,
    },
  });
  await prisma.user.create({
    data: { organizationId: org.id, email, passwordHash, role: "SUPER_ADMIN", isActive: true, mustChangePassword: true, emailVerifiedAt: new Date() },
  });

  console.log("\nPlatform owner created.\n");
  console.log(`  Email:    ${email}`);
  console.log(`  Password: ${password}   (one-time; you will be asked to change it)\n`);
  await prisma.$disconnect();
})().catch((err) => {
  console.error("Failed:", err.message);
  process.exit(1);
});
