require("dotenv").config();
const prisma = require("../src/config/database");

async function main() {
  const updated = await prisma.attendancePolicy.updateMany({
    data: { geofenceStrict: false },
  });
  console.log("geofenceStrict disabled for", updated.count, "policies");
}

main()
  .catch((err) => {
    console.error(err.message || err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
