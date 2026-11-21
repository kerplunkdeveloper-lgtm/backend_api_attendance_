
const cloudinary = require("../config/cloudinary");

const {
  uploadBuffer: uploadToS3,
  getDownloadUrl,
} = require("../config/s3");

const {
  assertSniffedType,
} = require("../middleware/upload.middleware");

const {
  sendControllerError,
} = require("../utils/controllerError");

const ALLOWED_SUBFOLDERS = [
  "uploads",
  "avatars",
  "receipts",
  "documents",
  "payslip-assets",
  "onboarding",
];

const ACCEPTED_DATA_URI =
  /^data:(image\/(?:jpeg|png|webp|gif)|application\/pdf);base64,([A-Za-z0-9+/]+={0,2})$/i;

const MAX_FILE_BYTES = 10 * 1024 * 1024;

function resolveFolder(requested) {
  return ALLOWED_SUBFOLDERS.includes(requested)
    ? requested
    : "uploads";
}

function parseDataUri(value) {
  const match = ACCEPTED_DATA_URI.exec(value);

  if (!match) {
    const error = new Error(
      "Invalid data URI. Use JPEG, PNG, WebP, GIF or PDF."
    );
    error.statusCode = 415;
    throw error;
  }

  const contentType = match[1].toLowerCase();
  const buffer = Buffer.from(match[2], "base64");

  if (
    buffer.length === 0 ||
    buffer.length > MAX_FILE_BYTES
  ) {
    const error = new Error("Invalid file size or file exceeds 10 MB.");
    error.statusCode = 413;
    throw error;
  }

  assertSniffedType({
    buffer,
    mimetype: contentType,
  });

  return { buffer, contentType };
}

async function uploadS3(buffer, {
  organizationId,
  folder,
  contentType,
}) {
  const result = await uploadToS3(buffer, {
    organizationId,
    folder,
    contentType,
  });

  const temporaryUrl = await getDownloadUrl(result.key, 300, organizationId);

  return {
    provider: "s3",
    bucket: result.bucket,
    key: result.key,

    // Temporary URL for immediate preview only.
    // Never persist this URL to the database.
    url: temporaryUrl,
    urlExpiresIn: 300,

    // Transitional compatibility field.
    // For S3 this is an object key, not a Cloudinary ID.
    publicId: result.key,

    format: contentType.split("/")[1],
    bytes: result.bytes,
    width: null,
    height: null,
  };
}

function cloudinaryResponse(result) {
  return {
    provider: "cloudinary",
    url: result.secure_url,
    publicId: result.public_id,
    format: result.format,
    bytes: result.bytes,
    width: result.width,
    height: result.height,
  };
}

class UploadController {
  async uploadImage(req, res) {
    try {
      const organizationId = req.user?.organizationId;

      if (!organizationId) {
        return res.status(403).json({
          success: false,
          message: "Organization access required.",
        });
      }

      const folder = resolveFolder(req.body?.folder);
      let buffer;
      let contentType;
      let cloudinarySource;

      if (req.file) {
        assertSniffedType(req.file);
        buffer = req.file.buffer;
        contentType = req.file.mimetype;
      } else {
        const value =
          req.body?.image ||
          req.body?.fileUrl ||
          req.body?.file;

        if (typeof value !== "string") {
          return res.status(400).json({
            success: false,
            message: "No file provided.",
          });
        }

        const parsed = parseDataUri(value);
        buffer = parsed.buffer;
        contentType = parsed.contentType;
        cloudinarySource = value;
      }

      let result;

      if (process.env.STORAGE_PROVIDER === "s3") {
        result = await uploadS3(buffer, {
          organizationId,
          folder,
          contentType,
        });
      } else {
        const options = {
          folder: `workpulse/${organizationId}/${folder}`,
          resource_type: "auto",
        };

        const uploaded = cloudinarySource
          ? await cloudinary.uploadImage(
              cloudinarySource,
              options
            )
          : await cloudinary.uploadBuffer(
              buffer,
              options
            );

        result = cloudinaryResponse(uploaded);
      }

      return res.status(200).json({
        success: true,
        message: "File uploaded successfully",
        data: result,
      });
    } catch (error) {
      console.error("Storage upload failed:", error);

      return sendControllerError(res, error, {
        fallbackStatus: 500,
        fallbackMessage: "Failed to upload file",
      });
    }
  }
}

module.exports = new UploadController();
