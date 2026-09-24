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

module.exports = {
  cloudinary,
  isConfigured,
  uploadImage,
  uploadBuffer,
  deleteImage,
};
