const test = require("node:test");
const assert = require("node:assert/strict");
const { employeeAvatarUrl, organizationLogoUrl, presentEmployeeImage } = require("../src/utils/privateMediaUrls");

test("legacy Cloudinary avatar stays unchanged", () => {
  const url = "https://res.cloudinary.com/example/image/upload/a.png";
  assert.equal(employeeAvatarUrl({ id: "emp-1", avatarUrl: url, avatarStorageKey: null }), url);
});
test("private employee S3 avatar resolves to tenant-authorized API endpoint", () => {
  const employee = { id: "emp-1", avatarUrl: null, avatarStorageKey: "organizations/org/avatars/key" };
  assert.equal(employeeAvatarUrl(employee), "/api/employees/emp-1/avatar-file");
  assert.equal(presentEmployeeImage(employee).avatarUrl, "/api/employees/emp-1/avatar-file");
});
test("legacy organization logo remains unchanged", () => {
  const url = "https://res.cloudinary.com/example/image/upload/logo.png";
  assert.equal(organizationLogoUrl({ id: "org-1", logoUrl: url, logoStorageKey: null }), url);
});
test("private organization logo resolves to authenticated endpoint", () => {
  assert.equal(organizationLogoUrl({ id: "org-1", logoUrl: null, logoStorageKey: "organizations/org-1/branding/key" }), "/api/organization/logo-file");
});
