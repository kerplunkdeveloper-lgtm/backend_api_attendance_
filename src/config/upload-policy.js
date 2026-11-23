const MB = 1024 * 1024;

// Keep every upload limit in one place. These values are deliberately small
// enough for an HR SaaS product while still allowing clear scanned documents.
const UPLOAD_POLICY = Object.freeze({
  avatar: { maxBytes: 2 * MB, allowed: ["image/jpeg", "image/png", "image/webp", "image/gif"] },
  logo: { maxBytes: 1 * MB, allowed: ["image/jpeg", "image/png", "image/webp"] },
  document: {
    maxBytes: 10 * MB,
    allowed: [
      "image/jpeg", "image/png", "image/webp", "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-powerpoint",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "application/rtf", "text/csv",
    ],
  },
  // Receipts commonly come directly from phone cameras. Keep this aligned with
  // the API body limit and the frontend validation so valid receipts do not
  // become a generic 413 response at the upload middleware.
  receipt: { maxBytes: 10 * MB, allowed: ["image/jpeg", "image/png", "image/webp", "application/pdf"] },
  htmlTemplate: { maxBytes: 1 * MB, allowed: ["text/html", "text/plain"] },
  templateAsset: { maxBytes: 1 * MB, allowed: ["image/jpeg", "image/png", "image/webp"] },
});

const STORAGE_QUOTA_BYTES = Object.freeze({
  FREE_TRIAL: 250 * MB,
  STARTER: 2 * 1024 * MB,
  PROFESSIONAL: 10 * 1024 * MB,
  ENTERPRISE: 50 * 1024 * MB,
});

module.exports = { MB, UPLOAD_POLICY, STORAGE_QUOTA_BYTES };
