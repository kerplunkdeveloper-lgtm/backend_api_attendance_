const express = require("express");
const deviceService = require("../services/device.service");
const {
  authenticate,
  authorizeRoles,
} = require("../middleware/auth.middleware");

const router = express.Router();

router.use(authenticate);

// 1. Register / Bind device (Employee)
router.post("/register", async (req, res) => {
  try {
    const device = await deviceService.registerDevice(
      req.user.id,
      req.user.organizationId,
      req.body,
    );
    return res
      .status(201)
      .json({
        success: true,
        message: "Device registered successfully",
        device,
      });
  } catch (err) {
    return res
      .status(err.statusCode || 400)
      .json({ success: false, message: err.message });
  }
});

// 2. Get my registered devices (Employee)
router.get("/my", async (req, res) => {
  try {
    const devices = await deviceService.getMyDevices(
      req.user.id,
      req.user.organizationId,
    );
    return res.json({ success: true, devices, data: devices });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// 3. Get all registered devices (Admin & Manager)
router.get(
  "/",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"),
  async (req, res) => {
    try {
      const devices = await deviceService.getAllDevices(
        req.user.organizationId,
      );
      return res.json({ success: true, devices, data: devices });
    } catch (err) {
      return res.status(err.statusCode || 500).json({ success: false, message: err.message });
    }
  },
);

// 4. Update Device Trust / Revoke (Admin)
router.put(
  "/:id/trust",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN"),
  async (req, res) => {
    try {
      const { isTrusted } = req.body;
      const device = await deviceService.updateDeviceTrust(
        req.params.id,
        req.user.organizationId,
        isTrusted,
      );
      const trusted = isTrusted === true || isTrusted === 1 || (typeof isTrusted === "string" && ["true", "1"].includes(isTrusted.trim().toLowerCase()));
      return res.json({
        success: true,
        message: `Device ${trusted ? "trusted" : "revoked"} successfully`,
        device,
      });
    } catch (err) {
      return res.status(err.statusCode || 500).json({ success: false, message: err.message });
    }
  },
);

// 5. Delete device
router.delete(
  "/:id",
  authorizeRoles("SUPER_ADMIN", "COMPANY_ADMIN"),
  async (req, res) => {
    try {
      await deviceService.deleteDevice(req.params.id, req.user.organizationId);
      return res.json({
        success: true,
        message: "Device removed successfully",
      });
    } catch (err) {
      return res.status(err.statusCode || 500).json({ success: false, message: err.message });
    }
  },
);

module.exports = router;
