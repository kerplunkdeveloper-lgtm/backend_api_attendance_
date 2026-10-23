const COMMON_CODE_PATTERN = /^([A-Z]{2,8})(\d+)$/i;
const LEGACY_PREFIXED_CODE_PATTERN = /^([A-Z0-9]{2,8})-(?:EMP|HR|ADM)-(\d+)$/i;

const prefixForRole = (role) => {
  switch (String(role || "EMPLOYEE").trim().toUpperCase()) {
    case "MANAGER":
    case "HR":
      return "HR";
    case "COMPANY_ADMIN":
    case "SUPER_ADMIN":
      return "ADM";
    default:
      return "EMP";
  }
};

const organizationPrefix = (organizationName) => {
  const words = String(organizationName || "WorkPluse")
    .trim()
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  const singleWord = words[0] || "WP";
  const camelInitials = singleWord.match(/[A-Z]/g);
  const prefix = words.length > 1
    ? words.slice(0, 3).map((word) => word[0]).join("")
    : camelInitials && camelInitials.length > 1
      ? camelInitials.slice(0, 2).join("")
      : singleWord.slice(0, 2);
  return (prefix || "WP").toUpperCase();
};

/**
 * Returns the next human-friendly employee code for one organization.
 * Legacy timestamp codes (six or more digits) are ignored so they do not
 * permanently pollute the sequence with values such as EMP-519622.
 */
const getNextEmployeeCode = async (organizationId, db, role = "EMPLOYEE", organizationName = "WorkPluse") => {
  const companyPrefix = organizationPrefix(organizationName);
  const employees = await db.employee.findMany({
    where: { organizationId },
    select: { employeeCode: true },
  });

  const used = new Set();
  let highest = 0;
  for (const employee of employees) {
    const value = String(employee.employeeCode || "").trim();
    const match = value.match(COMMON_CODE_PATTERN) || value.match(LEGACY_PREFIXED_CODE_PATTERN);
    if (!match || match[1].toUpperCase() !== companyPrefix) continue;
    const number = Number(match[2]);
    if (!Number.isInteger(number) || number < 1 || number > 99999) continue;
    used.add(number);
    highest = Math.max(highest, number);
  }

  let next = highest + 1;
  while (used.has(next)) next += 1;
  return `${companyPrefix}${String(next).padStart(3, "0")}`;
};

module.exports = { getNextEmployeeCode, prefixForRole, organizationPrefix };
