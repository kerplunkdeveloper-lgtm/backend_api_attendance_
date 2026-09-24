const prisma = require('../src/config/database');
async function check() {
  const orgs = await prisma.organization.findMany();
  console.log('Current orgs in DB:', orgs.map(o => ({ id: o.id, name: o.name, plan: o.subscriptionPlan, locked: o.planLocked })));
  if (orgs.some(o => o.planLocked)) {
    await prisma.organization.updateMany({ data: { planLocked: false } });
    console.log('Unlocked all existing organizations.');
  }
}
check().catch(console.error).finally(() => prisma.$disconnect());
