const express = require("express");
const orgController = require("../controllers/org.controller");
const {
  authenticate,
  authorizeRoles,
} = require("../middleware/auth.middleware");
const { imageUploader, handleUploadErrors } = require("../middleware/upload.middleware");

const logoFields = imageUploader(2).fields([
  { name: "logo", maxCount: 1 },
  { name: "image", maxCount: 1 },
  { name: "file", maxCount: 1 },
]);

const router = express.Router();
router.use(authenticate);
router.get("/", orgController.get);
router.put(
  "/",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN"),
  orgController.update,
);
router.post("/logo", authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN"), logoFields, handleUploadErrors, orgController.uploadLogo);
router.delete("/logo", authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN"), orgController.removeLogo);
module.exports = router;
