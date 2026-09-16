const { uploadImage, uploadBuffer } = require("../config/cloudinary");

class UploadController {
  /**
   * Upload an image to Cloudinary
   * Supports:
   * 1. Multipart form-data with file field 'image' or 'file' (via multer)
   * 2. JSON body with base64/data URI string in 'image' or 'fileUrl'
   */
  async uploadImage(req, res, next) {
    try {
      const folder = req.body.folder || "workpulse/uploads";

      // 1. Check if uploaded via multer (file buffer)
      if (req.file) {
        const result = await uploadBuffer(req.file.buffer, {
          folder,
          resource_type: "auto",
        });

        return res.status(200).json({
          success: true,
          message: "Image uploaded successfully to Cloudinary",
          data: {
            url: result.secure_url,
            publicId: result.public_id,
            format: result.format,
            bytes: result.bytes,
            width: result.width,
            height: result.height,
          },
        });
      }

      // 2. Check if uploaded via base64 data URI / remote URL
      const fileData = req.body.image || req.body.fileUrl || req.body.file;
      if (fileData) {
        const result = await uploadImage(fileData, {
          folder,
          resource_type: "auto",
        });

        return res.status(200).json({
          success: true,
          message: "Image uploaded successfully to Cloudinary",
          data: {
            url: result.secure_url,
            publicId: result.public_id,
            format: result.format,
            bytes: result.bytes,
            width: result.width,
            height: result.height,
          },
        });
      }

      return res.status(400).json({
        success: false,
        message: "No image provided. Please upload a file or supply a base64 data URI string.",
      });
    } catch (error) {
      console.error("Cloudinary upload error:", error);
      return res.status(500).json({
        success: false,
        message: error.message || "Failed to upload image to Cloudinary",
      });
    }
  }
}

module.exports = new UploadController();
