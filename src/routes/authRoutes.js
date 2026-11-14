
// backend/src/routes/authRoutes.js

const express = require("express");
const router = express.Router();

const authController = require("../controllers/authController");
const { protect } = require("../middleware/auth");
const { refreshLimiter } = require("../middleware/rateLimiter");

// Google Sign-In
router.post(
  "/google",
  authController.googleLogin
);

// Existing JWT refresh
router.post(
  "/refresh",
  refreshLimiter,
  authController.refreshToken
);

// Protected routes
router.get("/me", protect, authController.getMe);
router.put("/me", protect, authController.updateMe);

router.post("/logout", protect, authController.logout);

router.get(
  "/host-verification-status",
  protect,
  authController.getHostVerificationStatus
);

router.post(
  "/me/id-image",
  protect,
  authController.addIdImage
);

module.exports = router;
