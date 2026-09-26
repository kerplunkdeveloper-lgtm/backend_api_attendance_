require("dotenv").config();
const prisma = require("../src/config/database");

async function main() {
  await prisma.$executeRawUnsafe(`ALTER TABLE "Attendance" ADD COLUMN IF NOT EXISTS "checkInLocation" TEXT`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "Attendance" ADD COLUMN IF NOT EXISTS "checkOutLocation" TEXT`);
  console.log("punch location columns ready");
}

main()
  .catch((err) => {
    console.error(err.message || err);
    process.exitCode = 1;
  })
  .finally(() => {
    setTimeout(() => process.exit(process.exitCode || 0), 800);
  });
