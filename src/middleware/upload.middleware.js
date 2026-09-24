const multer = require("multer");

const IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
];

const DOCUMENT_MIME_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
];

const SIGNATURES = [
  { mime: "image/jpeg", bytes: [0xff, 0xd8, 0xff] },
  { mime: "image/png", bytes: [0x89, 0x50, 0x4e, 0x47] },
  { mime: "image/gif", bytes: [0x47, 0x49, 0x46, 0x38] },
  { mime: "application/pdf", bytes: [0x25, 0x50, 0x44, 0x46] },
  // RIFF....WEBP and the ZIP container used by docx/xlsx are checked separately.
];

const startsWith = (buffer, bytes) =>
  bytes.every((byte, index) => buffer[index] === byte);

const sniffType = (buffer) => {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) return null;

  for (const sig of SIGNATURES) {
    if (startsWith(buffer, sig.bytes)) return sig.mime;
  }
  if (
    startsWith(buffer, [0x52, 0x49, 0x46, 0x46]) &&
    buffer.slice(8, 12).toString() === "WEBP"
  ) {
    return "image/webp";
  }
  // docx/xlsx are ZIP archives; so is any other OOXML file.
  if (startsWith(buffer, [0x50, 0x4b, 0x03, 0x04])) return "application/zip";
  return null;
};

/**
 * Builds a multer instance that only accepts the given MIME types.
 *
 * @param {object} options
 * @param {string[]} options.allowed - Permitted MIME types.
 * @param {number} options.maxBytes - Per-file size cap.
 */
const createUploader = ({ allowed, maxBytes }) =>
  multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxBytes, files: 1 },
    fileFilter: (req, file, cb) => {
      if (!allowed.includes(file.mimetype)) {
        const err = new Error(
          `Unsupported file type '${file.mimetype}'. Allowed: ${allowed.join(", ")}`,
        );
        err.statusCode = 415;
        return cb(err);
      }
      cb(null, true);
    },
  });

/**
 * Rejects a file whose actual bytes disagree with its declared type.
 * Text-ish formats (csv, legacy doc/xls) have no reliable signature, so they pass through.
 */
const assertSniffedType = (file) => {
  if (!file || !file.buffer) return;

  const sniffed = sniffType(file.buffer);
  if (!sniffed) return;

  const declared = file.mimetype;
  const ooxml = [
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ];

  const matches =
    sniffed === declared ||
    (sniffed === "application/zip" && ooxml.includes(declared));

  if (!matches) {
    const err = new Error(
      `File contents (${sniffed}) do not match the declared type (${declared}).`,
    );
    err.statusCode = 415;
    throw err;
  }
};

/**
 * Normalises multer's own errors into the app's error envelope.
 */
const handleUploadErrors = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    const message =
      err.code === "LIMIT_FILE_SIZE"
        ? "File is too large."
        : `Upload failed: ${err.message}`;
    return res.status(413).json({ success: false, message });
  }
  if (err && err.statusCode === 415) {
    return res.status(415).json({ success: false, message: err.message });
  }
  return next(err);
};

const imageUploader = (maxMb = 10) =>
  createUploader({ allowed: IMAGE_MIME_TYPES, maxBytes: maxMb * 1024 * 1024 });

const documentUploader = (maxMb = 15) =>
  createUploader({
    allowed: [...IMAGE_MIME_TYPES, ...DOCUMENT_MIME_TYPES],
    maxBytes: maxMb * 1024 * 1024,
  });

module.exports = {
  IMAGE_MIME_TYPES,
  DOCUMENT_MIME_TYPES,
  createUploader,
  imageUploader,
  documentUploader,
  assertSniffedType,
  handleUploadErrors,
};
