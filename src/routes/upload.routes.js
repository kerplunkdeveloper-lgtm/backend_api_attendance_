const express = require("express");
const uploadController = require("../controllers/upload.controller");
const { authenticate } = require("../middleware/auth.middleware");
const { documentUploader, handleUploadErrors } = require("../middleware/upload.middleware");

const router = express.Router();

const upload = documentUploader(10);

// Every upload is attributed to a signed-in user; anonymous uploads would let
// anyone burn the Cloudinary quota and host arbitrary content on our account.
router.use(authenticate);

router.post("/image", upload.single("image"), uploadController.uploadImage);

router.post("/", upload.single("file"), uploadController.uploadImage);

router.use(handleUploadErrors);

module.exports = router;
