
const express = require("express");
const router = express.Router();

const authController = require("../controllers/authController");
const {
  protectPublic,
} = require("../middleware/auth");

const {
  refreshLimiter,
} = require("../middleware/rateLimiter");

// Public Google authentication.
router.post("/google", authController.googleLogin);

// Public refresh only accepts public refresh tokens.
router.post(
  "/refresh",
  refreshLimiter,
  authController.refreshToken
);

// All routes below require a public Traveler/Host access token.
router.get(
  "/me",
  protectPublic,
  authController.getMe
);

router.put(
  "/me",
  protectPublic,
  authController.updateMe
);

router.post(
  "/logout",
  protectPublic,
  authController.logout
);

router.get(
  "/host-verification-status",
  protectPublic,
  authController.getHostVerificationStatus
);

router.post(
  "/me/id-image",
  protectPublic,
  authController.addIdImage
);

module.exports = router;
