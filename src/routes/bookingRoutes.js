const express = require('express');
const router = express.Router();
const bookingController = require('../controllers/bookingController');
const { protect, isHost, authorize } = require('../middleware/auth');
const { 
  bookingValidators, 
  commonValidators, 
  handleValidationErrors 
} = require('../middleware/validation');
const { apiLimiter } = require('../middleware/rateLimiter');

// Public routes (with rate limiting)
router.post('/check-availability', apiLimiter, bookingController.checkAvailability);

// Protected routes - All booking routes require authentication
router.use(protect);

// Get bookings for current user
router.get('/my', bookingController.getMyBookings);

// Get host bookings (host only)
router.get('/host', isHost, bookingController.getHostBookings);

// Get host stats (host only)
router.get('/stats/host', isHost, bookingController.getHostStats);

// Create booking
router.post(
  '/',
  bookingValidators.create,
  handleValidationErrors,
  bookingController.createBooking
);

// Get single booking
router.get(
  '/:id',
  commonValidators.id(),
  handleValidationErrors,
  bookingController.getBooking
);

// Update booking status
router.put(
  '/:id/status',
  commonValidators.id(),
  bookingValidators.status,
  handleValidationErrors,
  bookingController.updateBookingStatus
);

// Cancel booking
router.post(
  '/:id/cancel',
  commonValidators.id(),
  handleValidationErrors,
  bookingController.cancelBooking
);

module.exports = router;