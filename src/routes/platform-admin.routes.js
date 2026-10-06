const express = require("express");
const controller = require("../controllers/platform-admin.controller");
const { authenticate, authorizeRoles } = require("../middleware/auth.middleware");

const router = express.Router();

// Platform owner only. Read-only, company-level data; never employee records.
router.use(authenticate, authorizeRoles("SUPER_ADMIN"));
router.get("/overview", controller.overview);
router.get("/attention", controller.attention);
router.get("/activity", controller.activity);
router.get("/clients", controller.listClients);
router.get("/clients/:id", controller.getClient);
router.post("/clients/:id/actions", controller.applyAction);

module.exports = router;
