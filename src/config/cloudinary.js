const cloudinary = require("cloudinary").v2;

// Configure Cloudinary with environment variables or provided defaults
cloudinary.config({
  cloud_name: (process.env.CLOUDINARY_CLOUD_NAME || "dubheb1lh").trim(),
  api_key: (process.env.CLOUDINARY_API_KEY || "343451632245467").trim(),
  api_secret: (process.env.CLOUDINARY_API_SECRET || "Pz6diWSqMcp6vonhMsX22svYvL0").trim(),
  secure: true,
});

/**
 * Upload an image or document to Cloudinary
 * @param {string} fileSource - File path, base64 data URI (e.g., "data:image/png;base64,..."), or remote URL
 * @param {object} options - Cloudinary upload options (e.g., folder, public_id, resource_type)
 * @returns {Promise<object>} Upload result from Cloudinary
 */
const uploadImage = async (fileSource, options = {}) => {
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
    const defaultOptions = {
      folder: "workpulse/uploads",
      resource_type: "auto",
    };

    const stream = cloudinary.uploader.upload_stream(
      { ...defaultOptions, ...options },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      }
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
  uploadImage,
  uploadBuffer,
  deleteImage,
};
