/* Cloudinary -> private S3 migration helper. Dry-run is the default. */
require("dotenv").config();
const prisma = require("../src/config/database");
const { uploadBuffer } = require("../src/config/s3");

const execute = process.argv.includes("--execute");
const max = Math.min(10000, Math.max(1, Number(process.env.S3_MIGRATION_LIMIT || 1000)));
const isCloudinaryUrl = (value) => typeof value === "string" && /(^|\.)cloudinary\.com\//i.test(value);
const download = async (url) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Cloudinary download failed (${response.status})`);
  return { buffer: Buffer.from(await response.arrayBuffer()), contentType: response.headers.get("content-type") || "application/octet-stream" };
};

async function migrateRows({ name, rows, getUrl, folder, update }) {
  let candidates = 0; let migrated = 0; let failed = 0;
  for (const row of rows) {
    const url = getUrl(row);
    if (!isCloudinaryUrl(url)) continue;
    candidates += 1;
    const item = { model: name, id: row.id, organizationId: row.organizationId, folder };
    if (!execute) { console.log(JSON.stringify({ ...item, url, status: "candidate" })); continue; }
    try {
      const file = await download(url);
      const uploaded = await uploadBuffer(file.buffer, { organizationId: row.organizationId, folder, contentType: file.contentType });
      await update(row, uploaded.key);
      migrated += 1;
      console.log(JSON.stringify({ ...item, storageKey: uploaded.key, status: "migrated" }));
    } catch (error) { failed += 1; console.error(JSON.stringify({ ...item, status: "failed", error: error.message })); }
  }
  return { candidates, migrated, failed };
}

async function main() {
  const [documents, expenses, onboarding, employees, users, organizations] = await Promise.all([
    prisma.employeeDocument.findMany({ where: { storageProvider: "cloudinary", fileUrl: { not: null } }, take: max }),
    prisma.expenseClaim.findMany({ where: { receiptStorageProvider: "cloudinary", receiptUrl: { not: null } }, take: max }),
    prisma.onboardingDocument.findMany({ where: { storageProvider: "cloudinary", fileUrl: { not: null } }, include: { candidate: { select: { organizationId: true } } }, take: max }),
    prisma.employee.findMany({ where: { avatarStorageKey: null, avatarUrl: { not: null } }, select: { id: true, organizationId: true, avatarUrl: true }, take: max }),
    prisma.user.findMany({ where: { avatarStorageKey: null, avatarUrl: { not: null }, organizationId: { not: null } }, select: { id: true, organizationId: true, avatarUrl: true }, take: max }),
    prisma.organization.findMany({ where: { logoStorageKey: null, logoUrl: { not: null } }, select: { id: true, logoUrl: true }, take: max }),
  ]);
  const onboardingRows = onboarding.map((row) => ({ ...row, organizationId: row.candidate.organizationId }));
  const organizationRows = organizations.map((row) => ({ ...row, organizationId: row.id }));
  const summary = {};
  summary.employeeDocuments = await migrateRows({ name: "EmployeeDocument", rows: documents, getUrl: (r) => r.fileUrl, folder: "documents", update: (r, key) => prisma.employeeDocument.update({ where: { id: r.id }, data: { storageProvider: "s3", storageKey: key, fileUrl: null } }) });
  summary.expenseReceipts = await migrateRows({ name: "ExpenseClaim", rows: expenses, getUrl: (r) => r.receiptUrl, folder: "receipts", update: (r, key) => prisma.expenseClaim.update({ where: { id: r.id }, data: { receiptStorageProvider: "s3", receiptStorageKey: key, receiptUrl: null } }) });
  summary.onboardingDocuments = await migrateRows({ name: "OnboardingDocument", rows: onboardingRows, getUrl: (r) => r.fileUrl, folder: "onboarding", update: (r, key) => prisma.onboardingDocument.update({ where: { id: r.id }, data: { storageProvider: "s3", storageKey: key, fileUrl: null } }) });
  summary.employeeAvatars = await migrateRows({ name: "Employee", rows: employees, getUrl: (r) => r.avatarUrl, folder: "avatars", update: (r, key) => prisma.employee.update({ where: { id: r.id }, data: { avatarStorageKey: key, avatarUrl: null } }) });
  summary.userAvatars = await migrateRows({ name: "User", rows: users, getUrl: (r) => r.avatarUrl, folder: "avatars", update: (r, key) => prisma.user.update({ where: { id: r.id }, data: { avatarStorageKey: key, avatarUrl: null } }) });
  summary.organizationLogos = await migrateRows({ name: "Organization", rows: organizationRows, getUrl: (r) => r.logoUrl, folder: "branding", update: (r, key) => prisma.organization.update({ where: { id: r.id }, data: { logoStorageProvider: "s3", logoStorageKey: key, logoUrl: null } }) });
  console.log(JSON.stringify({ mode: execute ? "execute" : "dry-run", summary }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
