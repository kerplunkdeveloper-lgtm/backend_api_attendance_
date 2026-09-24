const express = require("express");
const apikeyController = require("../controllers/apikey.controller");
const {
  authenticate,
  authorizeRoles,
} = require("../middleware/auth.middleware");

const router = express.Router();
router.use(authenticate);
router.use(authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN"));
router.get("/", apikeyController.list);
router.post("/", apikeyController.create);
router.delete("/:id", apikeyController.revoke);
module.exports = router;
