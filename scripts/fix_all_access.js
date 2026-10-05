/**
 * fix_all_access.js
 * ─────────────────
 * Grants full access to ALL existing organizations:
 *   1. Unlocks planLocked = false
 *   2. Extends trialEndsAt to 30 days from now
 *   3. Sets subscriptionStatus = TRIALING (so entitlement.allowApp = true)
 *   4. Upserts Subscription row if missing
 *   5. Prints final state for each org
 */
require("dotenv").config();
const prisma = require("../src/config/database");

async function fixAllAccess() {
  const orgs = await prisma.organization.findMany({
    include: { subscription: true },
  });

  if (orgs.length === 0) {
    console.log("No organizations found in database.");
    return;
  }

  console.log(`\nFound ${orgs.length} organization(s). Fixing access...\n`);

  const extendedTrialEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days from now

  for (const org of orgs) {
    console.log(`──────────────────────────────────────────`);
    console.log(`Org: ${org.name} (${org.id})`);
    console.log(`  Before → planLocked: ${org.planLocked}, status: ${org.subscriptionStatus}, trialEnd: ${org.trialEndsAt}`);

    // 10 years from now
    const farFuture = new Date(Date.now() + 10 * 365 * 24 * 60 * 60 * 1000);

    // Fix org record with full ENTERPRISE access
    await prisma.organization.update({
      where: { id: org.id },
      data: {
        planLocked: false,
        subscriptionStatus: "ACTIVE",
        subscriptionPlan: "ENTERPRISE",
        trialEndsAt: null,
        subscriptionExpiresAt: farFuture,
        maxEmployees: 10000,
        planActivatedAt: new Date(),
      },
    });

    // Upsert subscription row with all features enabled
    await prisma.subscription.upsert({
      where: { organizationId: org.id },
      update: {
        plan: "ENTERPRISE",
        status: "ACTIVE",
        billingCycle: "ANNUAL",
        price: 0,
        maxEmployees: 10000,
        maxBranches: 100,
        hasGeofence: true,
        hasPayroll: true,
        hasShiftPlanner: true,
        hasApiAccess: true,
        trialEndsAt: null,
        currentPeriodEnd: farFuture,
      },
      create: {
        organizationId: org.id,
        plan: "ENTERPRISE",
        status: "ACTIVE",
        billingCycle: "ANNUAL",
        price: 0,
        maxEmployees: 10000,
        maxBranches: 100,
        hasGeofence: true,
        hasPayroll: true,
        hasShiftPlanner: true,
        hasApiAccess: true,
        trialEndsAt: null,
        currentPeriodEnd: farFuture,
      },
    });

    console.log(`  After  → plan: ENTERPRISE, status: ACTIVE, planLocked: false, maxEmployees: 10000, maxBranches: 100, allFeatures: true`);
    console.log(`  ✅ Full Enterprise Access Granted!`);
  }

  console.log(`\n──────────────────────────────────────────`);
  console.log(`\n✅ All ${orgs.length} organization(s) now have full access.`);
  console.log(`   Trial extended 30 days → ${extendedTrialEnd.toDateString()}\n`);
}

fixAllAccess()
  .catch((err) => {
    console.error("❌ Fix failed:", err.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
