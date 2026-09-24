const { uploadImage, uploadBuffer } = require("../config/cloudinary");
const { assertSniffedType } = require("../middleware/upload.middleware");

// Clients may pick a sub-folder but not an arbitrary path — everything is
// rooted under the caller's own organization so one tenant can never write
// into, or overwrite, another tenant's assets.
const ALLOWED_SUBFOLDERS = [
  "uploads",
  "avatars",
  "receipts",
  "documents",
  "payslip-assets",
  "onboarding",
];

const ACCEPTED_DATA_URI =
  /^data:(image\/(jpeg|png|webp|gif)|application\/pdf);base64,/i;

const resolveFolder = (organizationId, requested) => {
  const sub = ALLOWED_SUBFOLDERS.includes(requested) ? requested : "uploads";
  return `workpulse/${organizationId}/${sub}`;
};

const toResponse = (result) => ({
  url: result.secure_url,
  publicId: result.public_id,
  format: result.format,
  bytes: result.bytes,
  width: result.width,
  height: result.height,
});

class UploadController {
  /**
   * Upload a file to Cloudinary.
   * Accepts either a multipart file (field 'image' or 'file') or a base64 data URI.
   */
  async uploadImage(req, res) {
    try {
      const folder = resolveFolder(req.user.organizationId, req.body.folder);

      if (req.file) {
        assertSniffedType(req.file);
        const result = await uploadBuffer(req.file.buffer, {
          folder,
          resource_type: "auto",
        });

        return res.status(200).json({
          success: true,
          message: "File uploaded successfully",
          data: toResponse(result),
        });
      }

      const fileData = req.body.image || req.body.fileUrl || req.body.file;
      if (fileData) {
        if (typeof fileData !== "string" || !ACCEPTED_DATA_URI.test(fileData)) {
          return res.status(415).json({
            success: false,
            message:
              "Inline uploads must be a base64 data URI of type image/jpeg, image/png, image/webp, image/gif or application/pdf.",
          });
        }

        const result = await uploadImage(fileData, {
          folder,
          resource_type: "auto",
        });

        return res.status(200).json({
          success: true,
          message: "File uploaded successfully",
          data: toResponse(result),
        });
      }

      return res.status(400).json({
        success: false,
        message:
          "No file provided. Upload a file or supply a base64 data URI string.",
      });
    } catch (error) {
      console.error("Cloudinary upload error:", error);
      return res.status(error.statusCode || 500).json({
        success: false,
        message: error.message || "Failed to upload file",
      });
    }
  }
}

module.exports = new UploadController();
