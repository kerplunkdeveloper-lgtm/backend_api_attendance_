require('dotenv').config();
const XLSX = require('../../admin_workpulse/node_modules/xlsx');
const prisma = require('../src/config/database');
const holidayService = require('../src/services/holiday.service');

async function testExcelFlow() {
  console.log('--- Testing STEP 7.1 — Holiday Excel/CSV Upload Flow ---');

  const org = await prisma.organization.findFirst();
  if (!org) {
    throw new Error('Organization not found');
  }

  // Clean up any test holidays
  await prisma.holiday.deleteMany({
    where: {
      organizationId: org.id,
      name: { in: ['Republic Day', 'Independence Day', 'Gandhi Jayanti', 'Christmas'] },
    },
  });

  // 1. Generate Excel Workbook simulating user upload
  const rawExcelRows = [
    {
      Date: '2026-01-26',
      'Holiday Name': 'Republic Day',
      Type: 'GOVERNMENT',
      Description: 'National Holiday',
    },
    {
      Date: '2026-08-15',
      'Holiday Name': 'Independence Day',
      Type: 'GOVERNMENT',
      Description: 'National Holiday',
    },
    {
      Date: '2026-10-02',
      'Holiday Name': 'Gandhi Jayanti',
      Type: 'GOVERNMENT',
      Description: 'National Holiday',
    },
    {
      Date: '2026-12-25',
      'Holiday Name': 'Christmas',
      Type: 'COMPANY',
      Description: 'Company Holiday',
    },
    {
      Date: 'invalid-date-format',
      'Holiday Name': 'Bad Date Holiday',
      Type: 'COMPANY',
      Description: 'Should fail validation',
    },
    {
      Date: '2026-05-01',
      'Holiday Name': '',
      Type: 'COMPANY',
      Description: 'Missing name should fail validation',
    },
  ];

  const ws = XLSX.utils.json_to_sheet(rawExcelRows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Holidays');
  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  console.log('✔ Generated Excel Buffer of size:', buffer.length, 'bytes');

  // 2. Parse Excel Buffer
  const readWb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const sheet = readWb.Sheets[readWb.SheetNames[0]];
  const parsedRows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  console.log('✔ Successfully parsed worksheet rows count:', parsedRows.length);

  // 3. Validate rows
  const validated = parsedRows.map((r, idx) => {
    const date = r.Date || r['Holiday Date'];
    const name = r['Holiday Name'] || r.name;
    const type = r.Type || 'GOVERNMENT';
    const desc = r.Description || '';
    const isValid = Boolean(date && name);
    return { rowNum: idx + 1, date, name, type, desc, isValid };
  });

  const validCount = validated.filter((r) => r.isValid).length;
  console.log(`✔ Validation Results: ${validCount} valid out of ${validated.length} total rows`);

  // 4. Import via bulkCreateHolidays service
  const importResult = await holidayService.bulkCreateHolidays(org.id, validated);
  console.log('✔ Bulk Import Result:', importResult);

  if (importResult.created === 4) {
    console.log('✔ PASS: All 4 Excel holidays created successfully in DB!');
  } else {
    console.error('FAIL: Expected 4 created, got:', importResult.created);
    process.exit(1);
  }

  // 5. Test Duplicate Prevention on Re-import
  const duplicateReimport = await holidayService.bulkCreateHolidays(org.id, validated);
  console.log('✔ Re-import Result (duplicate check):', duplicateReimport);
  if (duplicateReimport.created === 0 && duplicateReimport.skipped === validated.length) {
    console.log(`✔ PASS: All ${validated.length} items (including duplicates and invalid) were skipped on re-import!`);
  } else {
    console.error('FAIL on duplicate handling:', duplicateReimport);
    process.exit(1);
  }

  // 6. Query Holiday Calendar to verify inclusion
  const calendarHolidays = await holidayService.getHolidays(org.id, { year: 2026 });
  const matched = calendarHolidays.filter((h) =>
    ['Republic Day', 'Independence Day', 'Gandhi Jayanti', 'Christmas'].includes(h.name)
  );
  console.log(`✔ Verified in Holiday Calendar: ${matched.length} holidays retrieved for year 2026`);

  console.log('\n--- ALL STEP 7.1 EXCEL IMPORT TESTS PASSED SUCCESSFULLY! ---');
  await prisma.$disconnect();
}

testExcelFlow().catch((err) => {
  console.error('Test Failed:', err);
  process.exit(1);
});
