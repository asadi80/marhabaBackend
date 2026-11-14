const express = require("express");
const router = express.Router();

const authController = require("../controllers/authController");
const { protect } = require("../middleware/auth");
const { refreshLimiter } = require("../middleware/rateLimiter");

// Google signup / login
router.post("/google", authController.googleLogin);

// Refresh JWT
router.post("/refresh", refreshLimiter, authController.refreshToken);

// Protected routes
router.get("/me", protect, authController.getMe);
router.put("/me", protect, authController.updateMe);

router.post("/logout", protect, authController.logout);

// Host verification
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