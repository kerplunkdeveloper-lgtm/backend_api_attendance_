const test = require("node:test");
const assert = require("node:assert/strict");
const {
  employeeAvatarUrl,
  organizationLogoUrl,
  presentEmployeeImage,
  presentOrganizationImage,
} = require("../src/utils/privateMediaUrls");

test("legacy Cloudinary avatar stays unchanged", () => {
  const url = "https://res.cloudinary.com/example/image/upload/a.png";
  assert.equal(employeeAvatarUrl({ id: "emp-1", avatarUrl: url, avatarStorageKey: null }), url);
});
test("private employee S3 avatar resolves to tenant-authorized API endpoint", () => {
  const employee = { id: "emp-1", avatarUrl: null, avatarStorageKey: "organizations/org/avatars/key" };
  assert.equal(employeeAvatarUrl(employee), "/api/employees/emp-1/avatar-file");
  const presented = presentEmployeeImage(employee);
  assert.equal(presented.avatarUrl, "/api/employees/emp-1/avatar-file");
  assert.equal("avatarStorageKey" in presented, false);
});
test("legacy organization logo remains unchanged", () => {
  const url = "https://res.cloudinary.com/example/image/upload/logo.png";
  assert.equal(organizationLogoUrl({ id: "org-1", logoUrl: url, logoStorageKey: null }), url);
});
test("private organization logo resolves to authenticated endpoint", () => {
  const organization = { id: "org-1", logoUrl: null, logoStorageKey: "organizations/org-1/branding/key" };
  assert.equal(organizationLogoUrl(organization), "/api/organization/logo-file");
  const presented = presentOrganizationImage(organization);
  assert.equal(presented.logoUrl, "/api/organization/logo-file");
  assert.equal("logoStorageKey" in presented, false);
});
