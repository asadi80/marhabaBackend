
// src/routes/adminRoutes.js

const express = require("express");
const router = express.Router();

// Controllers
const adminController = require("../controllers/adminController");
const adminAuthController = require("../controllers/adminAuthController");

// Authentication middleware
const {
  protectAdmin,
  authorize,
} = require("../middleware/auth");

// Rate limiting
const {
  refreshLimiter,
} = require("../middleware/rateLimiter");

// Validation middleware
const {
  handleValidationErrors,
  commonValidators,
  userValidators,
} = require("../middleware/validation");

// ============================================================
// ADMIN AUTHENTICATION
// These routes must be registered BEFORE dashboard protection.
// ============================================================

// POST /api/v1/admin/auth/login
router.post(
  "/auth/login",
  adminAuthController.login
);

// POST /api/v1/admin/auth/refresh
router.post(
  "/auth/refresh",
  refreshLimiter,
  adminAuthController.refresh
);

// ============================================================
// PROTECT ADMIN DASHBOARD
// All routes below require a valid Admin/Super Admin token.
// ============================================================

router.use(protectAdmin);
router.use(authorize("admin", "super_admin"));

// ============================================================
// ADMIN AUTHENTICATED ACCOUNT
// ============================================================

// GET /api/v1/admin/auth/me
router.get(
  "/auth/me",
  adminAuthController.me
);

// POST /api/v1/admin/auth/logout
router.post(
  "/auth/logout",
  adminAuthController.logout
);

// ============================================================
// DASHBOARD
// ============================================================

// GET /api/v1/admin/stats
router.get(
  "/stats",
  adminController.getStats
);

// ============================================================
// USER MANAGEMENT
// ============================================================

// GET /api/v1/admin/users
router.get(
  "/users",
  adminController.getUsers
);

// GET /api/v1/admin/users/:id
router.get(
  "/users/:id",
  commonValidators.id("id"),
  handleValidationErrors,
  adminController.getUserById
);

// PUT /api/v1/admin/users/:id
router.put(
  "/users/:id",
  commonValidators.id("id"),
  userValidators.updateProfile,
  handleValidationErrors,
  adminController.updateUser
);

// DELETE /api/v1/admin/users/:id
// Super Admin only.
router.delete(
  "/users/:id",
  authorize("super_admin"),
  commonValidators.id("id"),
  handleValidationErrors,
  adminController.deleteUser
);

// POST /api/v1/admin/user/createAdmin
// Super Admin only.
router.post(
  "/user/createAdmin",
  authorize("super_admin"),
  userValidators.createAdmin,
  handleValidationErrors,
  adminController.createAdmin
);

// ============================================================
// USER DETAILS
// ============================================================

// GET /api/v1/admin/users/:id/listings
router.get(
  "/users/:id/listings",
  commonValidators.id("id"),
  handleValidationErrors,
  adminController.getUserListings
);

// GET /api/v1/admin/users/:id/bookings
router.get(
  "/users/:id/bookings",
  commonValidators.id("id"),
  handleValidationErrors,
  adminController.getUserBookings
);

// GET /api/v1/admin/users/:id/sessions
router.get(
  "/users/:id/sessions",
  commonValidators.id("id"),
  handleValidationErrors,
  adminController.getUserSessions
);

// GET /api/v1/admin/users/:id/events
router.get(
  "/users/:id/events",
  commonValidators.id("id"),
  handleValidationErrors,
  adminController.getUserEvents
);

// ============================================================
// HOST MANAGEMENT
// ============================================================

// GET /api/v1/admin/hosts/pending
router.get(
  "/hosts/pending",
  adminController.getPendingHosts
);

// PUT /api/v1/admin/hosts/:id/approve
router.put(
  "/hosts/:id/approve",
  commonValidators.id("id"),
  handleValidationErrors,
  adminController.approveHost
);

// PUT /api/v1/admin/hosts/:id/reject
router.put(
  "/hosts/:id/reject",
  commonValidators.id("id"),
  handleValidationErrors,
  adminController.rejectHost
);

// ============================================================
// LISTING MANAGEMENT
// ============================================================

// GET /api/v1/admin/listings
router.get(
  "/listings",
  adminController.getAllListings
);

// DELETE /api/v1/admin/listings/:id
router.delete(
  "/listings/:id",
  commonValidators.id("id"),
  handleValidationErrors,
  adminController.deleteListing
);

// ============================================================
// REPORTS
// ============================================================

// GET /api/v1/admin/reports/users
router.get(
  "/reports/users",
  adminController.getUserReport
);

// GET /api/v1/admin/reports/revenue
router.get(
  "/reports/revenue",
  adminController.getRevenueReport
);

// ============================================================
// PAYMENT MANAGEMENT
// ============================================================

// GET /api/v1/admin/payments/stats
router.get(
  "/payments/stats",
  adminController.getPaymentStats
);

// GET /api/v1/admin/payments
router.get(
  "/payments",
  adminController.getPayments
);

// GET /api/v1/admin/payments/:paymentId
router.get(
  "/payments/:paymentId",
  commonValidators.id("paymentId"),
  handleValidationErrors,
  adminController.getPayment
);

// PUT /api/v1/admin/payments/:paymentId/approve
router.put(
  "/payments/:paymentId/approve",
  commonValidators.id("paymentId"),
  handleValidationErrors,
  adminController.approvePayment
);

// PUT /api/v1/admin/payments/:paymentId/reject
router.put(
  "/payments/:paymentId/reject",
  commonValidators.id("paymentId"),
  handleValidationErrors,
  adminController.rejectPayment
);

// ============================================================
// IDENTITY DOCUMENT MANAGEMENT
// ============================================================

// PUT /api/v1/admin/doc/:documentId/reject
router.put(
  "/doc/:documentId/reject",
  commonValidators.id("documentId"),
  handleValidationErrors,
  adminController.rejectUserId
);

// PUT /api/v1/admin/doc/:documentId/pending
router.put(
  "/doc/:documentId/pending",
  commonValidators.id("documentId"),
  handleValidationErrors,
  adminController.setUserIdPending
);

// PUT /api/v1/admin/doc/:documentId/approve
router.put(
  "/doc/:documentId/approve",
  commonValidators.id("documentId"),
  handleValidationErrors,
  adminController.approveUserId
);

// ============================================================
// EXPORT
// ============================================================

module.exports = router;
