/* Public API paths only: raw S3 keys must never be sent to the browser as image URLs. */
const employeeAvatarUrl = (employee) => {
  if (!employee) return null;
  if ((employee.avatarStorageKey || employee.user?.avatarStorageKey) && employee.id) {
    return `/api/employees/${encodeURIComponent(String(employee.id))}/avatar-file`;
  }
  return employee.avatarUrl || employee.user?.avatarUrl || null;
};

const organizationLogoUrl = (organization) => {
  if (!organization) return null;
  return organization.logoStorageKey
    ? "/api/organization/logo-file"
    : (organization.logoUrl || null);
};

const presentEmployeeImage = (employee) => {
  if (!employee) return employee;
  const { avatarStorageKey, ...safe } = employee;
  if (safe.user && typeof safe.user === "object") {
    const { avatarStorageKey: userAvatarStorageKey, ...safeUser } = safe.user;
    safe.user = { ...safeUser };
    if (userAvatarStorageKey && !avatarStorageKey) {
      safe.avatarUrl = employeeAvatarUrl(employee);
      safe.user.avatarUrl = safe.avatarUrl;
    }
  }
  return { ...safe, avatarUrl: employeeAvatarUrl(employee) };
};

const presentOrganizationImage = (organization) => {
  if (!organization) return organization;
  const { logoStorageKey, ...safe } = organization;
  return { ...safe, logoUrl: organizationLogoUrl(organization) };
};

module.exports = {
  employeeAvatarUrl,
  organizationLogoUrl,
  presentEmployeeImage,
  presentOrganizationImage,
};
