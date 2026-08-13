// src/controllers/authController.js
const authService = require('../services/authService');
const { asyncHandler } = require('../middleware/errorHandler');
const { maskSensitiveData } = require('../utils/helpers');

// @desc    Register user
// @route   POST /api/v1/auth/register
// @access  Public
const register = asyncHandler(async (req, res) => {
  console.log("📝 Registration request received");
  console.log("  Body:", req.body);
  console.log("  Headers:", req.headers['content-type']);
  
  const userData = req.body;
  
  // Validate required fields
  const required = ['name', 'email', 'password', 'phone_number'];
  const missing = required.filter(field => !userData[field]);
  
  if (missing.length > 0) {
    return res.status(400).json({
      success: false,
      message: `Missing required fields: ${missing.join(', ')}`,
      errors: missing.map(field => ({
        field,
        message: `${field} is required`
      }))
    });
  }
  
  try {
    const result = await authService.register(userData);
    
    res.status(201).json({
      success: true,
      message: 'User registered successfully. Please verify your email.',
      data: {
        user: maskSensitiveData(result.user),
        tokens: result.tokens,
      },
    });
  } catch (error) {
    console.error('❌ Registration service error:', error);
    res.status(400).json({
      success: false,
      message: error.message || 'Registration failed',
    });
  }
});

// @desc    Login user
// @route   POST /api/v1/auth/login
// @access  Public
const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  
  // Parse device info from headers
  const deviceInfo = {
    ip: req.ip || req.headers['x-forwarded-for']?.split(',')[0] || null,
    userAgent: req.headers['user-agent'] || null,
    device: req.headers['x-device'] || 'desktop',
    browser: req.headers['x-browser'] || 'unknown',
    os: req.headers['x-os'] || 'unknown',
  };

  const result = await authService.login(email, password, deviceInfo);

  res.status(200).json({
    success: true,
    message: result.user.loginMessage || 'Login successful',
    data: {
      user: maskSensitiveData(result.user),
      tokens: result.tokens,
      requiresIdUpload: result.user.requiresIdUpload || false,
      isHostApproved: result.user.isHostApproved !== undefined ? result.user.isHostApproved : true,
    },
  });
});

// @desc    Logout user
// @route   POST /api/v1/auth/logout
// @access  Private
const logout = asyncHandler(async (req, res) => {
  const sessionId = req.body.session_id || null;
  await authService.logout(req.user.id, sessionId);

  res.status(200).json({
    success: true,
    message: 'Logged out successfully',
  });
});

// @desc    Refresh token
// @route   POST /api/v1/auth/refresh
// @access  Public
const refreshToken = asyncHandler(async (req, res) => {
  const { refresh_token } = req.body;

  if (!refresh_token) {
    return res.status(400).json({
      success: false,
      message: 'Refresh token is required',
    });
  }

  const tokens = await authService.refreshToken(refresh_token);

  res.status(200).json({
    success: true,
    data: { tokens },
  });
});

// @desc    Verify email
// @route   GET /api/v1/auth/verify-email/:token
// @access  Public
const verifyEmail = asyncHandler(async (req, res) => {
  try {
    const { token } = req.params;

    if (!token) {
      return res.redirect(
        `${process.env.NEXTAUTH_URL || "https://mar-haba.ly"}/verification-result?error=invalid-token`
      );
    }

    // Call authService.verifyEmail
    const result = await authService.verifyEmail(token);

    // Check if there was an error
    if (result.error) {
      return res.redirect(
        `${process.env.NEXTAUTH_URL || "https://mar-haba.ly"}/verification-result?error=${result.error}`
      );
    }

    // Success - redirect with verified status
    const redirectUrl = `${process.env.NEXTAUTH_URL || "https://mar-haba.ly"}/verification-result?verified=true&role=${result.user.role}`;
    return res.redirect(redirectUrl);
    
  } catch (error) {
    console.error("Email verification error:", error);
    return res.redirect(
      `${process.env.NEXTAUTH_URL || "https://mar-haba.ly"}/verification-result?error=server-error`
    );
  }
});

// @desc    Request password reset
// @route   POST /api/v1/auth/forgot-password
// @access  Public
const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({
      success: false,
      message: 'Email is required',
    });
  }

  const result = await authService.requestPasswordReset(email);

  res.status(200).json({
    success: true,
    message: result.message,
  });
});

// @desc    Reset password
// @route   POST /api/v1/auth/reset-password/:token
// @access  Public
const resetPassword = asyncHandler(async (req, res) => {
  const { token } = req.params;
  const { password } = req.body;

  if (!password) {
    return res.status(400).json({
      success: false,
      message: 'Password is required',
    });
  }

  const result = await authService.resetPassword(token, password);

  res.status(200).json({
    success: true,
    message: result.message,
  });
});

// @desc    Get current user profile
// @route   GET /api/v1/auth/me
// @access  Private
const getMe = asyncHandler(async (req, res) => {
  const user = await authService.getUserById(req.user.id);

  res.status(200).json({
    success: true,
    data: { user: maskSensitiveData(user) },
  });
});

// @desc    Update current user profile
// @route   PUT /api/v1/auth/me
// @access  Private
const updateMe = asyncHandler(async (req, res) => {
  const user = await authService.updateUser(req.user.id, req.body);

  res.status(200).json({
    success: true,
    message: 'Profile updated successfully',
    data: { user: maskSensitiveData(user) },
  });
});

// @desc    Change password
// @route   POST /api/v1/auth/change-password
// @access  Private
const changePassword = asyncHandler(async (req, res) => {
  const { current_password, new_password } = req.body;

  if (!current_password || !new_password) {
    return res.status(400).json({
      success: false,
      message: 'Current password and new password are required',
    });
  }

  const result = await authService.changePassword(
    req.user.id,
    current_password,
    new_password
  );

  res.status(200).json({
    success: true,
    message: result.message,
  });
});

module.exports = {
  register,
  login,
  logout,
  refreshToken,
  verifyEmail,
  forgotPassword,
  resetPassword,
  getMe,
  updateMe,
  changePassword,
};