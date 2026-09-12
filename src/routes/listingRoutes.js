const express = require("express");

const router = express.Router();

const listingController = require("../controllers/listingController");

const { protect, isHost } = require("../middleware/auth");

const {
  listingValidators,
  commonValidators,
  handleValidationErrors,
} = require("../middleware/validation");


// ============================================================
// PUBLIC ROUTES
// ============================================================

// GET /api/v1/listings
router.get(
  "/",
  listingController.getListings
);


// ============================================================
// GET NEARBY LISTINGS
// IMPORTANT: MUST COME BEFORE /:id
// GET /api/v1/listings/nearby
// ============================================================

router.get(
  "/nearby",
  listingController.getNearbyListings
);


// ============================================================
// GET USER LISTING
// GET /api/v1/listings/user/:id
// ============================================================

router.get(
  "/user/:id",
  commonValidators.id(),
  handleValidationErrors,
  listingController.getListingForUser
);


// ============================================================
// GET HOST LISTINGS
// GET /api/v1/listings/host/:hostId
// ============================================================

router.get(
  "/host/:hostId",
  commonValidators.id("hostId"),
  handleValidationErrors,
  listingController.getHostListings
);


// ============================================================
// GET SINGLE LISTING
// GET /api/v1/listings/:id
// PUBLIC
// ============================================================

router.get(
  "/:id",
  commonValidators.id(),
  handleValidationErrors,
  listingController.getListing
);


// ============================================================
// PROTECTED ROUTES — HOST ONLY
// ============================================================


// CREATE LISTING
// POST /api/v1/listings

router.post(
  "/",
  protect,
  isHost,
  listingValidators.create,
  handleValidationErrors,
  listingController.createListing
);


// UPDATE LISTING
// PUT /api/v1/listings/:id

router.put(
  "/:id",
  protect,
  isHost,
  commonValidators.id(),
  listingValidators.update,
  handleValidationErrors,
  listingController.updateListing
);


// UPDATE BLOCKED DATES
// PATCH /api/v1/listings/:id/blocked-dates

router.patch(
  "/:id/blocked-dates",
  protect,
  isHost,
  commonValidators.id(),
  listingValidators.update,
  handleValidationErrors,
  listingController.updateBlockedDates
);


// DELETE SPECIFIC BLOCKED DATE
// DELETE /api/v1/listings/:listingId/blocked-dates/:blockedDateId

router.delete(
  "/:listingId/blocked-dates/:blockedDateId",
  protect,
  isHost,
  handleValidationErrors,
  listingController.deleteBlockedDate
);


// DELETE LISTING
// DELETE /api/v1/listings/:id

router.delete(
  "/:id",
  protect,
  isHost,
  commonValidators.id(),
  handleValidationErrors,
  listingController.deleteListing
);


// TOGGLE LISTING ACTIVE
// PATCH /api/v1/listings/:id/toggle-active

router.patch(
  "/:id/toggle-active",
  protect,
  isHost,
  commonValidators.id(),
  listingValidators.update,
  handleValidationErrors,
  listingController.toggleListingActive
);


// INCREMENT VIEW COUNT
// POST /api/v1/listings/:id/view

router.post(
  "/:id/view",
  commonValidators.id(),
  handleValidationErrors,
  listingController.incrementListingView
);


module.exports = router;