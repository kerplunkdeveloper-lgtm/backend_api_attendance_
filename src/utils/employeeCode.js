const EMPLOYEE_CODE_PATTERN = /^EMP-(\d+)$/i;

/**
 * Returns the next human-friendly employee code for one organization.
 * Legacy timestamp codes (six or more digits) are ignored so they do not
 * permanently pollute the sequence with values such as EMP-519622.
 */
const getNextEmployeeCode = async (organizationId, db) => {
  const employees = await db.employee.findMany({
    where: { organizationId },
    select: { employeeCode: true },
  });

  const used = new Set();
  let highest = 0;
  for (const employee of employees) {
    const match = String(employee.employeeCode || "").trim().match(EMPLOYEE_CODE_PATTERN);
    if (!match) continue;
    const number = Number(match[1]);
    if (!Number.isInteger(number) || number < 1 || number > 99999) continue;
    used.add(number);
    highest = Math.max(highest, number);
  }

  let next = highest + 1;
  while (used.has(next)) next += 1;
  return `EMP-${String(next).padStart(3, "0")}`;
};

module.exports = { getNextEmployeeCode };
