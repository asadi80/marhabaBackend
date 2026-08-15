// routes/authRoutes.js
const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { protect } = require('../middleware/auth');
const { authLimiter } = require('../middleware/rateLimiter');
const { userValidators, handleValidationErrors } = require('../middleware/validation');

// Public routes with rate limiting
router.post('/register', authLimiter, userValidators.register, handleValidationErrors, authController.register);
router.post('/login', authLimiter, userValidators.login, handleValidationErrors, authController.login);
router.post('/refresh', authLimiter, authController.refreshToken);

// Email verification routes
router.get('/verify-email', authController.verifyEmail);
router.post('/resend-verification', authLimiter, authController.resendVerification);
router.get('/check-verification', authLimiter, authController.checkVerificationStatus);

// Password reset routes
router.post('/forgot-password', authLimiter, authController.forgotPassword);
router.post('/reset-password/:token', authLimiter, authController.resetPassword);

// Protected routes
router.get('/me', protect, authController.getMe);
router.put('/me', protect, userValidators.updateProfile, handleValidationErrors, authController.updateMe);
router.post('/change-password', protect, authController.changePassword);
router.post('/logout', protect, authController.logout);

module.exports = router;