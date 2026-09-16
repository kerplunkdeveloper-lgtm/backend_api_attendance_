const express = require("express");
const multer = require("multer");
const uploadController = require("../controllers/upload.controller");

const router = express.Router();

// Memory storage for direct streaming to Cloudinary
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
});

// Upload image (accepts multipart field 'image' or 'file', or JSON body)
router.post(
  "/image",
  upload.single("image"),
  uploadController.uploadImage
);

// General file upload alias
router.post(
  "/",
  upload.single("file"),
  uploadController.uploadImage
);

module.exports = router;
