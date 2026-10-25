// routes/authRoutes.js
const express = require("express");
const router = express.Router();
const authController = require("../controllers/authController");
const { protect } = require("../middleware/auth");
const { authLimiter, refreshLimiter } = require("../middleware/rateLimiter");
const { userValidators, handleValidationErrors } = require("../middleware/validation");

// ─────────────────────────────────────────────────────────────
// PUBLIC ROUTES
//
// authLimiter (10 / 15 min / IP) is applied ONLY to
// brute-force-sensitive anonymous endpoints. Authenticated reads
// and logout use the general limiter already applied in app.js.
// ─────────────────────────────────────────────────────────────

// Registration & login
router.post(
  "/register",
  authLimiter,
  userValidators.register,
  handleValidationErrors,
  authController.register,
);

router.post(
  "/login",
  authLimiter,
  userValidators.login,
  handleValidationErrors,
  authController.login,
);

// Refresh uses a *separate*, more generous limiter — refresh fires
// automatically on token expiry and shouldn't be blocked at 10/15min.
router.post("/refresh", refreshLimiter, authController.refreshToken);

// Email verification
router.get("/verify-email", authLimiter, authController.verifyEmail);
router.post("/resend-verification", authLimiter, authController.resendVerification);
router.get("/check-verification", authLimiter, authController.checkVerificationStatus);

// Password reset
router.post("/forgot-password", authLimiter, authController.forgotPassword);
router.post("/reset-password/:token", authLimiter, authController.resetPassword);

// ─────────────────────────────────────────────────────────────
// PROTECTED ROUTES
//
// Use the global generalLimiter (from app.js) — NOT authLimiter.
// AuthLimiter here would lock users out of their own dashboards.
// ─────────────────────────────────────────────────────────────
router.get("/me", protect, authController.getMe);

// NOTE: userValidators.updateProfile was removed — the new controller's
// validateUpdateMe() enforces the field whitelist. If you keep the
// middleware, verify it also whitelists name/phone_number/avatar_url/
// bio/locale ONLY (no role/status/email).
router.put("/me", protect, authController.updateMe);

router.post("/change-password", protect, authController.changePassword);
router.post("/logout", protect, authController.logout);
router.get("/host-verification-status", protect, authController.getHostVerificationStatus);
router.post("/me/id-image", protect, authController.addIdImage);

module.exports = router;