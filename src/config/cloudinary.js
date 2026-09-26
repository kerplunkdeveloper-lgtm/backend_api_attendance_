const cloudinary = require("cloudinary").v2;

const cloudName = (process.env.CLOUDINARY_CLOUD_NAME || "").trim();
const apiKey = (process.env.CLOUDINARY_API_KEY || "").trim();
const apiSecret = (process.env.CLOUDINARY_API_SECRET || "").trim();

const isConfigured = Boolean(cloudName && apiKey && apiSecret);

if (isConfigured) {
  cloudinary.config({
    cloud_name: cloudName,
    api_key: apiKey,
    api_secret: apiSecret,
    secure: true,
  });
} else {
  console.warn(
    "[cloudinary] CLOUDINARY_* env vars are not set. File uploads will be rejected.",
  );
}

const assertConfigured = () => {
  if (!isConfigured) {
    const error = new Error(
      "File storage is not configured on this server. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET.",
    );
    error.statusCode = 503;
    throw error;
  }
};

/**
 * Upload an image or document to Cloudinary
 * @param {string} fileSource - File path, base64 data URI (e.g., "data:image/png;base64,..."), or remote URL
 * @param {object} options - Cloudinary upload options (e.g., folder, public_id, resource_type)
 * @returns {Promise<object>} Upload result from Cloudinary
 */
const uploadImage = async (fileSource, options = {}) => {
  assertConfigured();
  const defaultOptions = {
    folder: "workpulse/uploads",
    resource_type: "auto",
  };

  return await cloudinary.uploader.upload(fileSource, {
    ...defaultOptions,
    ...options,
  });
};

/**
 * Upload a file buffer via upload_stream
 * @param {Buffer} buffer - File buffer from multer memory storage
 * @param {object} options - Cloudinary upload options
 * @returns {Promise<object>} Upload result
 */
const uploadBuffer = (buffer, options = {}) => {
  return new Promise((resolve, reject) => {
    try {
      assertConfigured();
    } catch (err) {
      return reject(err);
    }

    const defaultOptions = {
      folder: "workpulse/uploads",
      resource_type: "auto",
    };

    const stream = cloudinary.uploader.upload_stream(
      { ...defaultOptions, ...options },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      },
    );

    stream.end(buffer);
  });
};

/**
 * Delete an asset from Cloudinary by public ID
 * @param {string} publicId
 * @param {object} options
 */
const deleteImage = async (publicId, options = {}) => {
  return await cloudinary.uploader.destroy(publicId, options);
};

const SENSITIVE_DOCUMENT_TYPES = new Set([
  "AADHAAR",
  "PAN",
  "PASSPORT",
  "DRIVING_LICENCE",
  "BANK_DOCUMENT",
  "BANK_PROOF",
  "GOVT_ID",
  "TAX_ID",
]);

const isSensitiveDocumentType = (type) =>
  SENSITIVE_DOCUMENT_TYPES.has(String(type || "").toUpperCase());

const publicIdFromUrl = (fileUrl) => {
  if (!fileUrl || typeof fileUrl !== "string") return null;
  const match = fileUrl.match(/\/(?:image|raw|video|auto)\/(?:upload|authenticated|private)\/(?:v\d+\/)?(.+)$/);
  if (!match) return null;
  return match[1].replace(/\.[a-zA-Z0-9]+$/, "");
};

/**
 * Time-limited Cloudinary URL for identity and bank documents.
 * Legacy public URLs still resolve if signing is unavailable.
 */
const signedDeliveryUrl = (fileUrl, { ttlSeconds = 300, authenticated = false } = {}) => {
  if (!fileUrl || !isConfigured) return fileUrl;
  const publicId = publicIdFromUrl(fileUrl);
  if (!publicId) return fileUrl;
  try {
    return cloudinary.url(publicId, {
      resource_type: "auto",
      type: authenticated ? "authenticated" : "upload",
      sign_url: true,
      secure: true,
      expires_at: Math.floor(Date.now() / 1000) + ttlSeconds,
    });
  } catch {
    return fileUrl;
  }
};

module.exports = {
  cloudinary,
  isConfigured,
  uploadImage,
  uploadBuffer,
  deleteImage,
  signedDeliveryUrl,
  isSensitiveDocumentType,
};
