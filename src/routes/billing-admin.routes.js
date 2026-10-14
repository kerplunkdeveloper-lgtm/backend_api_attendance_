const express = require("express");
const controller = require("../controllers/billing-admin.controller");
const { authenticate, authorizeRoles } = require("../middleware/auth.middleware");
const { validate, schemas } = require("../middleware/validate.middleware");
const { requireOwnerTwoFactor } = require("../middleware/twoFactor.middleware");

const router = express.Router();
router.use(authenticate, authorizeRoles("SUPER_ADMIN"), requireOwnerTwoFactor);
router.get("/prices", controller.listPrices);
router.put("/prices/:plan/:billingCycle", validate(schemas.billingPlanPrice), controller.updatePrice);
router.get("/limits", controller.listLimits);
router.put("/limits/:plan", controller.updateLimit);
router.get("/offers", controller.listOffers);
router.post("/offers", validate(schemas.billingOfferCreate), controller.createOffer);
router.put("/offers/:id", validate(schemas.billingOfferUpdate), controller.updateOffer);
router.delete("/offers/:id", controller.deactivateOffer);

module.exports = router;
