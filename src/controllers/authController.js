// src/controllers/authController.js

const { prisma } = require("../config/database");

console.log("🔍 Loading authController...");
console.log("📦 Prisma type:", typeof prisma);

const authService = require("../services/authService");
const { asyncHandler } = require("../middleware/errorHandler");
const { maskSensitiveData } = require("../utils/helpers");
const emailService = require("../services/emailService");

console.log("✅ AuthController loaded, prisma type:", typeof prisma);

// @desc    Register user
// @route   POST /api/v1/auth/register
// @access  Public
const register = asyncHandler(async (req, res) => {
  console.log("📝 Registration request received");
  console.log("  Body:", req.body);
  console.log("  Headers:", req.headers["content-type"]);

  const userData = req.body;

  // Validate required fields
  const required = ["name", "email", "password", "phone_number"];
  const missing = required.filter((field) => !userData[field]);

  if (missing.length > 0) {
    return res.status(400).json({
      success: false,
      message: `Missing required fields: ${missing.join(", ")}`,
      errors: missing.map((field) => ({
        field,
        message: `${field} is required`,
      })),
    });
  }

  try {
    const result = await authService.register(userData);

    res.status(201).json({
      success: true,
      message: "User registered successfully. Please verify your email.",
      data: {
        user: maskSensitiveData(result.user),
        tokens: result.tokens,
      },
    });
  } catch (error) {
    console.error("❌ Registration service error:", error);
    res.status(400).json({
      success: false,
      message: error.message || "Registration failed",
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
    ip: req.ip || req.headers["x-forwarded-for"]?.split(",")[0] || null,
    userAgent: req.headers["user-agent"] || null,
    device: req.headers["x-device"] || "desktop",
    browser: req.headers["x-browser"] || "unknown",
    os: req.headers["x-os"] || "unknown",
  };

  try {
    const result = await authService.login(email, password, deviceInfo);

    // For host users, check verification status
    let verificationStatus = null;
    if (result.user.role === "host") {
      const hostDetails = result.user.host_details || {};
      const latestPayment = result.user.host_subscription_payments?.[0] || null;

      verificationStatus = {
        id: {
          uploaded: result.user.id_images && result.user.id_images.length > 0,
          verified: hostDetails.id_verified || false,
          verified_at: hostDetails.id_verified_at || null,
          rejected: hostDetails.id_rejected || false,
          rejection_reason: hostDetails.id_rejection_reason || null,
        },
        payment: {
          uploaded:
            latestPayment &&
            latestPayment.receipt_images &&
            latestPayment.receipt_images.length > 0,
          status: latestPayment ? latestPayment.status : "pending",
          amount: latestPayment ? latestPayment.amount : null,
          submitted_at: latestPayment ? latestPayment.created_at : null,
          approved_at: hostDetails.payment_verified_at || null,
          rejected: hostDetails.payment_rejected || false,
          rejection_reason: hostDetails.payment_rejection_reason || null,
        },
        overall_status: result.user.status,
      };
    }

    res.status(200).json({
      success: true,
      message: result.user.loginMessage || "Login successful",
      data: {
        user: maskSensitiveData(result.user),
        tokens: result.tokens,
        requiresIdUpload: result.user.requiresIdUpload || false,
        isHostApproved:
          result.user.isHostApproved !== undefined
            ? result.user.isHostApproved
            : true,
        // Include verification status for host users
        verificationStatus: verificationStatus,
      },
    });
  } catch (error) {
    // Check if it's a verification error
    if (error.code === "EMAIL_NOT_VERIFIED") {
      return res.status(403).json({
        success: false,
        code: "EMAIL_NOT_VERIFIED",
        message: error.message,
        userData: error.userData,
        resendLink: `/resend-verification?email=${encodeURIComponent(error.userData.email)}`,
      });
    }

    // Handle other errors
    return res.status(401).json({
      success: false,
      message: error.message || "Login failed",
    });
  }
});

// @desc    Logout user
// @route   POST /api/v1/auth/logout
// @access  Private
const logout = asyncHandler(async (req, res) => {
  const sessionId = req.body.session_id || null;
  await authService.logout(req.user.id, sessionId);

  res.status(200).json({
    success: true,
    message: "Logged out successfully",
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
      message: "Refresh token is required",
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
    console.log("🔍 VERIFY EMAIL REQUEST");
    console.log("URL:", req.originalUrl);
    console.log("Query:", req.query);

    const { token } = req.query;

    if (!token) {
      console.log("❌ No verification token received");
      return res.redirect(
        `${process.env.FRONTEND_URL || "https://mar-haba.ly"}/verification-result?error=invalid-token`,
      );
    }

    console.log("✅ Verification token received");

    const result = await authService.verifyEmail(token);

    console.log("🔍 Verification result:", result);

    // Handle different error cases
    if (result.error === "token-expired") {
      return res.redirect(
        `${process.env.FRONTEND_URL || "https://mar-haba.ly"}/verification-result?status=expired&email=${encodeURIComponent(result.user?.email || "")}&message=Your verification link has expired. Please request a new one.`,
      );
    }

    if (result.error === "already-verified") {
      // Redirect to login with already verified message
      return res.redirect(
        `${process.env.FRONTEND_URL || "https://mar-haba.ly"}/verification-result?status=already-verified&email=${encodeURIComponent(result.user?.email || "")}&message=Email is already verified. You can login now.`,
      );
    }

    if (result.error === "invalid-token") {
      return res.redirect(
        `${process.env.FRONTEND_URL || "https://mar-haba.ly"}/verification-result?error=invalid-token&message=Invalid verification link. Please request a new one.`,
      );
    }

    // ✅ SUCCESS - Email verified!
    if (result.success) {
      // Redirect to verification result page with success status
      // The result page will show success message and auto-redirect to login
      const redirectUrl =
        `${process.env.FRONTEND_URL || "https://mar-haba.ly"}` +
        `/verification-result?status=success&email=${encodeURIComponent(result.user.email)}&name=${encodeURIComponent(result.user.name)}&role=${encodeURIComponent(result.user.role)}&redirect=/login`;

      return res.redirect(redirectUrl);
    }

    // Fallback
    return res.redirect(
      `${process.env.FRONTEND_URL || "https://mar-haba.ly"}/verification-result?error=unknown`,
    );
  } catch (error) {
    console.error("❌ Email verification error:", error);
    return res.redirect(
      `${process.env.FRONTEND_URL || "https://mar-haba.ly"}/verification-result?error=server-error&message=${encodeURIComponent(error.message)}`,
    );
  }
});

// @desc    Resend verification email
// @route   POST /api/v1/auth/resend-verification
// @access  Public
const resendVerification = asyncHandler(async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({
      success: false,
      message: "Email is required",
    });
  }

  try {
    const result = await authService.resendVerificationEmail(email);

    return res.status(200).json({
      success: true,
      message: result.message,
      data: {
        tokenExpiry: result.tokenExpiry,
        email: email,
      },
    });
  } catch (error) {
    console.error("❌ Resend verification error:", error.message);

    if (error.message === "User not found") {
      return res.status(404).json({
        success: false,
        message: "No account found with this email address.",
      });
    }

    if (error.message === "Email is already verified") {
      return res.status(400).json({
        success: false,
        message: "This email is already verified. You can login directly.",
      });
    }

    return res.status(500).json({
      success: false,
      message:
        error.message ||
        "Failed to resend verification email. Please try again.",
    });
  }
});

// Check verification status endpoint
const checkVerificationStatus = asyncHandler(async (req, res) => {
  const { email } = req.query;

  if (!email) {
    return res.status(400).json({
      success: false,
      message: "Email is required",
    });
  }

  try {
    const status = await authService.checkVerificationStatus(email);

    return res.status(200).json({
      success: true,
      data: status,
    });
  } catch (error) {
    console.error("❌ Check verification status error:", error.message);

    if (error.message === "User not found") {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    return res.status(500).json({
      success: false,
      message: error.message || "Failed to check verification status",
    });
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
      message: "Email is required",
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
      message: "Password is required",
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
    message: "Profile updated successfully",
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
      message: "Current password and new password are required",
    });
  }

  const result = await authService.changePassword(
    req.user.id,
    current_password,
    new_password,
  );

  res.status(200).json({
    success: true,
    message: result.message,
  });
});

const addIdImage = asyncHandler(async (req, res) => {
  if (!req.body.url) {
    return res.status(400).json({
      success: false,
      message: "Image URL is required",
    });
  }

  const { url } = req.body;

  const user = await prisma.user.update({
    where: {
      id: req.user.id,
    },
    data: {
      id_images: {
        push: url,
      },
    },
    select: {
      id: true,
      name: true,
      email: true,
      phone_number: true,
      id_images: true,
    },
  });

  return res.status(200).json({
    success: true,
    message: "ID image added successfully",
    user,
  });
});

// @desc    Get host verification status
// @route   GET /api/v1/auth/host-verification-status
// @access  Private (Host only)
const getHostVerificationStatus = asyncHandler(async (req, res) => {
  try {
    const userId = req.user.id;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        user_id_documents: {
          orderBy: {
            created_at: "desc",
          },
        },

        host_subscription_payments: {
          orderBy: {
            created_at: "desc",
          },
          take: 1,
        },
      },
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // If user is not a host, return a basic response
    if (user.role !== "host") {
      const idDocuments = user.user_id_documents || [];

      return res.status(200).json({
        success: true,
        data: {
          id: {
            uploaded: idDocuments.length > 0,

            documents: idDocuments,

            // Latest document status
            status: idDocuments[0]?.status || "pending",

            verified:
              idDocuments.length > 0 &&
              idDocuments.every((doc) => doc.status === "approved"),

            verified_at:
              idDocuments.length > 0 &&
              idDocuments.every((doc) => doc.status === "approved")
                ? idDocuments
                    .filter((doc) => doc.reviewed_at)
                    .sort(
                      (a, b) =>
                        new Date(b.reviewed_at) - new Date(a.reviewed_at),
                    )[0]?.reviewed_at || null
                : null,

            rejected: idDocuments.some((doc) => doc.status === "rejected"),

            rejection_reason:
              idDocuments.find((doc) => doc.status === "rejected")
                ?.rejection_reason || null,
          },
          payment: {
            uploaded: false,
            status: "pending",
            amount: null,
            submitted_at: null,
            approved_at: null,
            rejected: false,
            rejection_reason: null,
          },
          overall_status: user.status,
        },
      });
    }

    const hostDetails = user.host_details || {};
    const latestPayment = user.host_subscription_payments[0] || null;

    // Check if payment is rejected from host_details
    const paymentRejected = hostDetails.payment_rejected || false;
    const paymentStatus = latestPayment ? latestPayment.status : "pending";

    // If payment is rejected in host_details but status is still pending, update it
    const finalPaymentStatus = paymentRejected ? "rejected" : paymentStatus;

    const verificationStatus = {
      id: {
        uploaded: user.id_images && user.id_images.length > 0,
        verified: hostDetails.id_verified || false,
        verified_at: hostDetails.id_verified_at || null,
        rejected: hostDetails.id_rejected || false,
        rejection_reason: hostDetails.id_rejection_reason || null,
      },
      payment: {
        uploaded:
          latestPayment &&
          latestPayment.receipt_images &&
          latestPayment.receipt_images.length > 0,
        status: finalPaymentStatus,
        amount: latestPayment ? latestPayment.amount : null,
        submitted_at: latestPayment ? latestPayment.created_at : null,
        approved_at: hostDetails.payment_verified_at || null,
        rejected: paymentRejected,
        rejection_reason: hostDetails.payment_rejection_reason || null,
      },
      overall_status: user.status,
    };

    res.status(200).json({
      success: true,
      data: verificationStatus,
    });
  } catch (error) {
    console.error("❌ Error fetching host verification status:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch verification status",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

module.exports = {
  register,
  login,
  logout,
  refreshToken,
  verifyEmail,
  resendVerification,
  checkVerificationStatus,
  forgotPassword,
  resetPassword,
  getMe,
  updateMe,
  changePassword,
  addIdImage,
  getHostVerificationStatus,
};
