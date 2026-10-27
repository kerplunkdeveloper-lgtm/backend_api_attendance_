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

/**
 * Reads the parts of a stored Cloudinary URL that decide how it must be delivered: the resource type
 * (image, raw or video), the delivery type (upload = public, authenticated, private), the version and the
 * file name. Returns null for anything that is not a Cloudinary delivery URL.
 */
const parseDeliveryUrl = (fileUrl) => {
  if (!fileUrl || typeof fileUrl !== "string") return null;
  const match = fileUrl.split(/[?#]/)[0].match(/\/(image|raw|video)\/(upload|authenticated|private)\/(?:s--[\w-]+--\/)?(?:v(\d+)\/)?(.+)$/);
  if (!match) return null;
  const [, resourceType, deliveryType, version, path] = match;
  let name;
  try {
    name = decodeURIComponent(path);
  } catch {
    name = path;
  }
  // Images and videos are addressed without their extension (it is the format); raw files keep it in the id.
  const dot = name.match(/\.([a-zA-Z0-9]+)$/);
  const keepsExtension = resourceType === "raw";
  return {
    resourceType,
    deliveryType,
    version: version ? Number(version) : undefined,
    publicId: dot && !keepsExtension ? name.slice(0, -dot[0].length) : name,
    format: dot && !keepsExtension ? dot[1] : undefined,
  };
};

/**
 * A link that opens an uploaded document. It is built from how the file was actually stored, so it works for
 * every upload: public files keep their URL, and files stored as "authenticated" get a signed URL (a plain
 * authenticated URL is refused by Cloudinary). The "authenticated" option is kept for older callers and is
 * ignored: the stored URL is the source of truth, and asking for the wrong type returns "not found".
 */
const signedDeliveryUrl = (fileUrl) => {
  if (!fileUrl || !isConfigured) return fileUrl;
  const parsed = parseDeliveryUrl(fileUrl);
  if (!parsed || parsed.deliveryType === "upload") return fileUrl;
  try {
    return cloudinary.url(parsed.publicId, {
      resource_type: parsed.resourceType,
      type: parsed.deliveryType,
      version: parsed.version,
      format: parsed.format,
      sign_url: true,
      secure: true,
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
  parseDeliveryUrl,
  isSensitiveDocumentType,
};
