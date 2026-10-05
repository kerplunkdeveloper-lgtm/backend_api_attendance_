/**
 * reset_admin_password.js
 * ────────────────────────
 * Reset the password for any user by email.
 * Usage:  node scripts/reset_admin_password.js <email> <newPassword>
 * Example: node scripts/reset_admin_password.js vasanth@kerplunkmedia.com NewPass@123
 */
require("dotenv").config();
const bcrypt = require("bcryptjs");
const prisma = require("../src/config/database");

async function resetPassword() {
  const email = process.argv[2];
  const newPassword = process.argv[3];

  if (!email || !newPassword) {
    console.error("Usage: node scripts/reset_admin_password.js <email> <newPassword>");
    console.error("Example: node scripts/reset_admin_password.js vasanth@kerplunkmedia.com NewPass@123");
    process.exit(1);
  }

  if (newPassword.length < 8) {
    console.error("❌ Password must be at least 8 characters.");
    process.exit(1);
  }

  const users = await prisma.user.findMany({
    where: { email: { equals: email.toLowerCase(), mode: "insensitive" } },
    select: { id: true, email: true, role: true, organizationId: true },
  });

  if (users.length === 0) {
    console.error(`❌ No user found with email: ${email}`);
    process.exit(1);
  }

  const salt = await bcrypt.genSalt(10);
  const passwordHash = await bcrypt.hash(newPassword, salt);

  for (const user of users) {
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash, mustChangePassword: false, isActive: true },
    });
    console.log(`✅ Password reset for: ${user.email} (role: ${user.role})`);
  }

  console.log("\n🔑 You can now login with:");
  console.log(`   Email:    ${email}`);
  console.log(`   Password: ${newPassword}`);
}

resetPassword()
  .catch((err) => {
    console.error("❌ Error:", err.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
