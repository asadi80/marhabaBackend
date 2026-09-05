// src/routes/bookingRoutes.js

const express = require("express");

const router = express.Router();

const bookingController = require("../controllers/bookingController");

const {
  protect,
  isHost,
} = require("../middleware/auth");

const {
  bookingValidators,
  commonValidators,
  handleValidationErrors,
} = require("../middleware/validation");

const { apiLimiter } = require("../middleware/rateLimiter");

// ============================================================
// PUBLIC ROUTES
// ============================================================

// Check booking availability
router.post(
  "/check-availability",
  apiLimiter,
  bookingController.checkAvailability
);

// ============================================================
// PROTECTED ROUTES
// ============================================================

router.use(protect);

// ============================================================
// CURRENT USER BOOKINGS
// ============================================================

// GET /api/v1/bookings
router.get(
  "/",
  bookingController.getMyBookings
);

// GET /api/v1/bookings/my-booking
router.get(
  "/my-booking",
  bookingController.getMyBookings
);

// ============================================================
// HOST BOOKINGS
// ============================================================

// GET /api/v1/bookings/host
router.get(
  "/host",
  isHost,
  bookingController.getHostBookings
);

// ============================================================
// HOST STATS
// ============================================================

// GET /api/v1/bookings/stats/host
router.get(
  "/stats/host",
  isHost,
  bookingController.getHostStats
);

// ============================================================
// CREATE BOOKING
// ============================================================

// POST /api/v1/bookings/create
router.post(
  "/create",
  bookingValidators.create,
  handleValidationErrors,
  bookingController.createBooking
);

// ============================================================
// SINGLE BOOKING
// ============================================================

// GET /api/v1/bookings/:id
router.get(
  "/:id",
  commonValidators.id(),
  handleValidationErrors,
  bookingController.getBookingById
);

// ============================================================
// UPDATE BOOKING STATUS
// ============================================================

// PUT /api/v1/bookings/:id/status
router.put(
  "/:id/status",
  commonValidators.id(),
  bookingValidators.status,
  handleValidationErrors,
  bookingController.updateBookingStatus
);

// ============================================================
// CANCEL BOOKING
// ============================================================

// POST /api/v1/bookings/:id/cancel
router.post(
  "/:id/cancel",
  commonValidators.id(),
  handleValidationErrors,
  bookingController.cancelBooking
);

module.exports = router;