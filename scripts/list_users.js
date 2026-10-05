require("dotenv").config();
const prisma = require("../src/config/database");

prisma.user.findMany({
  select: { id: true, email: true, role: true, organizationId: true, isActive: true }
}).then(users => {
  console.log("Users in DB:", JSON.stringify(users, null, 2));
}).catch(e => console.error(e.message))
  .finally(() => prisma.$disconnect());
