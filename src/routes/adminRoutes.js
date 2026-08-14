// src/routes/adminRoutes.js
const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { protect, authorize } = require('../middleware/auth');
const { 
  handleValidationErrors, 
  commonValidators,
  userValidators,
  listingValidators 
} = require('../middleware/validation');

// All admin routes are protected and require admin or super_admin role
router.use(protect);
router.use(authorize('admin', 'super_admin'));

// ==================== Dashboard ====================
// GET /api/v1/dashboard/stats
router.get('/stats', adminController.getStats);

// ==================== User Management ====================
// GET /api/v1/admin/users
router.get('/users', adminController.getUsers);

// GET /api/v1/dashboard/users/:id
router.get(
  '/users/:id',
  authorize('admin','super_admin'),
  commonValidators.id('id'),
  handleValidationErrors,
  adminController.getUserById
);

// PUT /api/v1/dashboard/users/:id
router.put(
  '/users/:id',
  authorize('admin','super_admin'),
  commonValidators.id('id'),
  userValidators.updateProfile,
  handleValidationErrors,
  adminController.updateUser
);

// DELETE /api/v1/admin/users/:id
router.delete(
  '/users/:id',
  authorize('admin','super_admin'),

  commonValidators.id('id'),
  handleValidationErrors,
  adminController.deleteUser
);

// POST /api/v1/admin/users (Create admin/super_admin)
router.post(
  '/user/createAdmin',
  protect,
  authorize('super_admin'),
  userValidators.createAdmin,
  handleValidationErrors,
  adminController.createAdmin
);

// ==================== User Details ====================
// GET /api/v1/admin/users/:id/listings
router.get(
  '/users/:id/listings',
    authorize('admin','super_admin'),

  commonValidators.id('id'),
  handleValidationErrors,
  adminController.getUserListings
);

// GET /api/v1/admin/users/:id/bookings
router.get(
  '/users/:id/bookings',
    authorize('admin','super_admin'),

  commonValidators.id('id'),
  handleValidationErrors,
  adminController.getUserBookings
);

// GET /api/v1/admin/users/:id/sessions
router.get(
  '/users/:id/sessions',
    authorize('admin','super_admin'),

  commonValidators.id('id'),
  handleValidationErrors,
  adminController.getUserSessions
);

// GET /api/v1/admin/users/:id/events
router.get(
  '/users/:id/events',
    authorize('admin','super_admin'),

  commonValidators.id('id'),
  handleValidationErrors,
  adminController.getUserEvents
);

// ==================== Host Management ====================
// GET /api/v1/admin/hosts/pending
router.get('/hosts/pending', adminController.getPendingHosts);

// PUT /api/v1/admin/hosts/:id/approve
router.put(
  '/hosts/:id/approve',
  commonValidators.id('id'),
  handleValidationErrors,
  adminController.approveHost
);

// PUT /api/v1/admin/hosts/:id/reject
router.put(
  '/hosts/:id/reject',
  commonValidators.id('id'),
  handleValidationErrors,
  adminController.rejectHost
);

// ==================== Listing Management ====================
// GET /api/v1/admin/listings
router.get('/listings', adminController.getAllListings);

// DELETE /api/v1/admin/listings/:id
router.delete(
  '/listings/:id',
  commonValidators.id('id'),
  handleValidationErrors,
  adminController.deleteListing
);

// ==================== Reports ====================
// GET /api/v1/admin/reports/users
router.get('/reports/users', adminController.getUserReport);

// GET /api/v1/admin/reports/revenue
router.get('/reports/revenue', adminController.getRevenueReport);

module.exports = router;