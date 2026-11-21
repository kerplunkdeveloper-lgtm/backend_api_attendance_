/**
 * One-employee Cloudinary -> private S3 avatar pilot.
 * No writes without --execute --confirm-pilot. Never bulk migrates records.
 *
 * Usage:
 * node scripts/pilot-cloudinary-avatar-to-s3.js --employee-id=ID --backup=/absolute/protected/file.json
 * node scripts/pilot-cloudinary-avatar-to-s3.js --employee-id=ID --backup=/absolute/protected/file.json --execute --confirm-pilot
 */
require("dotenv").config();
const fs = require("node:fs");
const crypto = require("node:crypto");
const prisma = require("../src/config/database");
const { uploadBuffer, getFileContent, deleteObject } = require("../src/config/s3");

const getArg = (name) => {
  const match = process.argv.find((arg) => arg.startsWith(name + "="));
  return match ? match.slice(name.length + 1) : null;
};
const employeeId = getArg("--employee-id");
const backupPath = getArg("--backup");
const execute = process.argv.includes("--execute");
const confirmed = process.argv.includes("--confirm-pilot");
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

function imageMime(bytes) {
  if (bytes.length >= 3 && bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return "image/jpeg";
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) return "image/png";
  if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  if (bytes.length >= 6 && ["GIF87a", "GIF89a"].includes(bytes.toString("ascii", 0, 6))) return "image/gif";
  throw new Error("Cloudinary response is not a supported image");
}

async function main() {
  if (!employeeId || !backupPath || !backupPath.startsWith("/")) {
    throw new Error("Require --employee-id=ID and --backup=/absolute/path/to/verified.json");
  }
  if (execute && !confirmed) throw new Error("Writes require both --execute and --confirm-pilot");
  if (process.env.STORAGE_PROVIDER !== "cloudinary") {
    throw new Error("Stop: keep STORAGE_PROVIDER=cloudinary during pilot");
  }
  if (process.env.S3_BUCKET_NAME !== "attendance-media-prod-live") {
    throw new Error("Unexpected S3 bucket; stopping");
  }
  const backupStat = fs.statSync(backupPath);
  if (!backupStat.isFile() || (backupStat.mode & 0o077)) {
    throw new Error("Backup must be a private file (e.g. chmod 600)");
  }
  const backup = JSON.parse(fs.readFileSync(backupPath, "utf8"));
  const source = backup.employees?.find((row) => row.id === employeeId);
  if (!source || !source.avatarUrl || source.avatarStorageKey) {
    throw new Error("Employee not found in original backup, or backup already has S3 key");
  }
  const record = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { id: true, organizationId: true, avatarUrl: true, avatarStorageKey: true, deletedAt: true },
  });
  if (!record || record.deletedAt || record.avatarStorageKey ||
      record.avatarUrl !== source.avatarUrl ||
      record.organizationId !== source.organizationId) {
    throw new Error("Live row differs from protected backup; refusing migration");
  }
  const url = new URL(record.avatarUrl);
  if (url.protocol !== "https:" ||
      url.hostname !== "res.cloudinary.com" ||
      !url.pathname.includes("/image/upload/") ||
      url.username || url.password || url.port) {
    throw new Error("Not an approved public Cloudinary image URL");
  }
  console.log(JSON.stringify({
    mode: execute ? "one-employee-pilot" : "dry-run",
    employeeId: record.id,
    organizationId: record.organizationId,
    originalUrlPreservedInBackup: true,
    currentStorageKey: null,
  }));
  if (!execute) return;
  const response = await fetch(url, { signal: AbortSignal.timeout(30000), redirect: "error" });
  if (!response.ok) throw new Error("Cloudinary download failed: " + response.status);
  const announcedSize = Number(response.headers.get("content-length") || 0);
  const LIMIT = 10 * 1024 * 1024;
  if (announcedSize > LIMIT) throw new Error("Image is larger than 10MiB");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > LIMIT) throw new Error("Image is empty or larger than 10MiB");
  const mime = imageMime(bytes);
  let uploadedKey = null;
  let committed = false;
  try {
    const uploaded = await uploadBuffer(bytes, {
      organizationId: record.organizationId,
      folder: "avatars",
      contentType: mime,
    });
    uploadedKey = uploaded.key;
    const downloaded = await getFileContent(uploadedKey, record.organizationId);
    if (sha256(bytes) !== sha256(downloaded.buffer)) {
      throw new Error("S3 downloaded bytes do not match Cloudinary download");
    }
    const changed = await prisma.employee.updateMany({
      where: {
        id: record.id,
        organizationId: record.organizationId,
        avatarStorageKey: null,
        avatarUrl: record.avatarUrl,
      },
      data: { avatarStorageKey: uploadedKey, avatarUrl: null },
    });
    if (changed.count !== 1) throw new Error("Record changed concurrently; no DB update committed");
    committed = true;
    console.log(JSON.stringify({
      status: "PILOT_MIGRATED",
      employeeId: record.id,
      s3Key: uploadedKey,
      bytes: bytes.length,
      sha256: sha256(bytes),
      originalUrl: "stored in protected backup",
      nextStep: "Verify the private avatar endpoint and frontend before any further migration",
    }));
  } finally {
    if (uploadedKey && !committed) {
      try { await deleteObject(uploadedKey, record.organizationId); }
      catch (error) { console.error("Manual orphan S3 cleanup may be needed:", uploadedKey, error.message); }
    }
  }
}

main()
  .catch((error) => { console.error("PILOT FAILED:", error.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
