const express = require("express");
const router = express.Router();
const listingController = require("../controllers/listingController");
const { protect, isHost } = require("../middleware/auth");
const {
  listingValidators,
  commonValidators,
  handleValidationErrors,
} = require("../middleware/validation");
const { listingLimiter } = require("../middleware/rateLimiter");

// Public routes
router.get("/", listingController.getListings);
router.get(
  "/user/:id",
  commonValidators.id(),
  handleValidationErrors,
  listingController.getListingForUser,
);
router.get(
  "/host/:hostId",
  commonValidators.id("hostId"),
  handleValidationErrors,
  listingController.getHostListings,
);

// Protected routes

router.get(
  "/:id",
   protect,
  isHost,
  commonValidators.id(),
  handleValidationErrors,
  listingController.getListing,
);

router.post(
  "/",
  protect,
  isHost,
  listingValidators.create,
  handleValidationErrors,
  listingController.createListing,
);

router.put(
  "/:id",
  protect,
  isHost,
  commonValidators.id(),
  listingValidators.update,
  handleValidationErrors,
  listingController.updateListing,
);

router.delete(
  "/:id",
  protect,
  isHost,
  commonValidators.id(),
  handleValidationErrors,
  listingController.deleteListing,
);

router.patch(
  "/:id/toggle-active",
  protect,
  isHost,
  commonValidators.id(),
  listingValidators.update,
  handleValidationErrors,
  listingController.toggleListingActive,
);

module.exports = router;
