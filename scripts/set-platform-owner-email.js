/**
 * Changes the platform owner's sign-in email.
 *
 *   node scripts/set-platform-owner-email.js new-owner@yourdomain.com
 *
 * The password is unchanged.
 */
require("dotenv").config();
const prisma = require("../src/config/database");

(async () => {
  const email = String(process.argv[2] || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    console.error("Usage: node scripts/set-platform-owner-email.js new-owner@yourdomain.com");
    process.exit(1);
  }
  const owner = await prisma.user.findFirst({ where: { role: "SUPER_ADMIN" } });
  if (!owner) {
    console.error("No platform owner exists yet. Run scripts/create-platform-owner.js first.");
    process.exit(1);
  }
  const clash = await prisma.user.findFirst({ where: { email: { equals: email, mode: "insensitive" }, id: { not: owner.id } } });
  if (clash) {
    console.error("That email is already used by another account.");
    process.exit(1);
  }
  await prisma.$transaction([
    prisma.user.update({ where: { id: owner.id }, data: { email } }),
    prisma.organization.update({ where: { id: owner.organizationId }, data: { email } }),
  ]);
  console.log(`Platform owner email changed from ${owner.email} to ${email}`);
  await prisma.$disconnect();
})().catch((err) => {
  console.error("Failed:", err.message);
  process.exit(1);
});
