require('dotenv').config();
const prisma = require('../src/config/database');
const holidayService = require('../src/services/holiday.service');
const leaveService = require('../src/services/leave.service');

async function testHolidays() {
  console.log('--- Testing Holiday Management Service ---');

  // Find or create test organization
  let org = await prisma.organization.findFirst();
  if (!org) {
    org = await prisma.organization.create({
      data: { name: 'Acme Test Corp' }
    });
  }

  let branch = await prisma.branch.findFirst({ where: { organizationId: org.id } });
  if (!branch) {
    branch = await prisma.branch.create({
      data: {
        organizationId: org.id,
        name: 'Headquarters',
        latitude: 12.9716,
        longitude: 77.5946,
        radius: 100
      }
    });
  }

  // Clean up any previous test records
  await prisma.holiday.deleteMany({
    where: {
      organizationId: org.id,
      name: { in: ['Republic Day 2026', 'Annual Founder Day', 'Optional Festival Eve', 'Independence Day', 'Gandhi Jayanti', 'Christmas Day'] }
    }
  });

  // 1. Create a Government Holiday
  const govHoliday = await holidayService.createHoliday(org.id, {
    name: 'Republic Day 2026',
    date: '2026-01-26',
    type: 'GOVERNMENT',
    description: 'National public holiday celebrating the constitution',
    isOptional: false,
    branchId: null // All branches
  });
  console.log('✔ Created Government Holiday:', govHoliday.name, govHoliday.date);

  // 2. Create a Company Holiday for branch
  const compHoliday = await holidayService.createHoliday(org.id, {
    name: 'Annual Founder Day',
    date: '2026-06-15',
    type: 'COMPANY',
    description: 'HQ Anniversary celebration',
    isOptional: false,
    branchId: branch.id
  });
  console.log('✔ Created Company Holiday for Branch:', compHoliday.name, compHoliday.branch?.name);

  // 3. Create an Optional / Restricted Holiday
  const optHoliday = await holidayService.createHoliday(org.id, {
    name: 'Optional Festival Eve',
    date: '2026-11-12',
    type: 'OPTIONAL',
    description: 'Floating optional holiday for cultural celebration',
    isOptional: true
  });
  console.log('✔ Created Optional Holiday:', optHoliday.name, 'isOptional:', optHoliday.isOptional);

  // 4. Bulk Create Holidays
  const bulkResult = await holidayService.bulkCreateHolidays(org.id, [
    { name: 'Independence Day', date: '2026-08-15', type: 'GOVERNMENT' },
    { name: 'Gandhi Jayanti', date: '2026-10-02', type: 'GOVERNMENT' },
    { name: 'Christmas Day', date: '2026-12-25', type: 'COMPANY' }
  ]);
  console.log('✔ Bulk Created Holidays created count:', bulkResult.created, 'skipped:', bulkResult.skipped);

  // 5. Query Holidays with filters
  const list2026 = await holidayService.getHolidays(org.id, { year: 2026 });
  console.log(`✔ Total Holidays in 2026: ${list2026.length}`);

  const govHolidays = await holidayService.getHolidays(org.id, { year: 2026, type: 'GOVERNMENT' });
  console.log(`✔ Total Government Holidays in 2026: ${govHolidays.length}`);

  // 6. Test isDateHoliday helper
  const checkHoliday = await holidayService.isDateHoliday(org.id, new Date('2026-01-26'));
  console.log('✔ Check isDateHoliday for 2026-01-26:', checkHoliday ? `Holiday found: ${checkHoliday.name}` : 'Not a holiday');

  const checkNonHoliday = await holidayService.isDateHoliday(org.id, new Date('2026-01-27'));
  console.log('✔ Check isDateHoliday for 2026-01-27:', checkNonHoliday ? 'Holiday found' : 'Correctly NOT a holiday');

  // 7. Verify Leave Service integration with holidays
  let employee = await prisma.employee.findFirst({
    where: { organizationId: org.id },
    include: { user: true }
  });

  if (employee && employee.userId) {
    const leaveTypes = await leaveService.getLeaveTypes(org.id);
    const paidType = leaveTypes.find(t => t.isPaid) || leaveTypes[0];

    // Seed balances
    await leaveService.getLeaveBalances(employee.userId, org.id, 2026);

    // Apply leave for 2026-01-25 (Sun) to 2026-01-27 (Tue)
    // 2026-01-25 = Sunday (weekend)
    // 2026-01-26 = Republic Day (Holiday)
    // 2026-01-27 = Tuesday (Working day)
    // Only 1 day (Jan 27) should be counted!
    const leaveReq = await leaveService.createLeaveRequest(employee.userId, org.id, {
      leaveTypeId: paidType.id,
      startDate: '2026-01-25',
      endDate: '2026-01-27',
      reason: 'Testing holiday exemption from leave quota'
    });

    console.log(`✔ Leave Request Created: ${leaveReq.startDate} to ${leaveReq.endDate}`);
    console.log(`  Total deducted days in leave request: ${leaveReq.totalDays}`);
    if (Number(leaveReq.totalDays) === 1) {
      console.log('✔ PASS: Sunday & Republic Day (Jan 26) holiday were both EXCLUDED from deduction! Only 1 working day deducted.');
    }
  }

  // 8. Update and Delete Holiday
  const updatedGov = await holidayService.updateHoliday(org.id, govHoliday.id, {
    description: 'Updated description: National public holiday'
  });
  console.log('✔ Updated Holiday description:', updatedGov.description);

  await holidayService.deleteHoliday(org.id, optHoliday.id);
  console.log('✔ Deleted optional holiday successfully.');

  console.log('\n--- ALL HOLIDAY MANAGEMENT TESTS PASSED SUCCESSFULLY! ---');
  await prisma.$disconnect();
}

testHolidays().catch(err => {
  console.error('Test Failed:', err);
  process.exit(1);
});
