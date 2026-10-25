// src/controllers/authController.js
const { prisma } = require("../config/database");
const authService = require("../services/authService");
const { asyncHandler } = require("../middleware/errorHandler");
const { maskSensitiveData } = require("../utils/helpers");
const { getDeviceInfo } = require("../utils/deviceInfo");
const { AppError, ErrorCodes } = require("../utils/errors");
const { buildVerificationStatus } = require("../services/verificationFormatter");
const {
  validateRegister,
  validateLogin,
  validateUpdateMe,
  validateChangePassword,
  validateAddIdImage,
  validateEmailOnly,
} = require("../validators/authValidators");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function handleServiceError(error, res, fallbackMessage, fallbackStatus = 400) {
  // Known typed errors from service layer
  if (error instanceof AppError) {
    return res.status(error.status).json({
      success: false,
      code: error.code,
      message: error.message,
      ...(error.meta && Object.keys(error.meta).length ? { errors: error.meta } : {}),
    });
  }

  // Never leak internals (Prisma, DB, stack) to clients
  // eslint-disable-next-line no-console
  console.error("❌ Service error:", error);

  return res.status(fallbackStatus).json({
    success: false,
    code: ErrorCodes.INTERNAL_ERROR,
    message: fallbackMessage,
  });
}

// ---------------------------------------------------------------------------
// POST /api/v1/auth/register
// ---------------------------------------------------------------------------
const register = asyncHandler(async (req, res) => {
  let userData;
  try {
    userData = validateRegister(req.body);
  } catch (error) {
    return handleServiceError(error, res, "Invalid registration data");
  }

  const deviceInfo = getDeviceInfo(req);

  try {
    const result = await authService.register(userData, deviceInfo);
    return res.status(201).json({
      success: true,
      message: "User registered successfully. Please verify your email.",
      data: {
        user: maskSensitiveData(result.user),
        tokens: result.tokens,
      },
    });
  } catch (error) {
    // Service should throw AppError for known failures; generic DB errors → 500
    const status = error instanceof AppError ? error.status : 500;
    const message =
      error instanceof AppError
        ? error.message
        : "Registration failed. Please try again.";
    if (!(error instanceof AppError)) {
      // eslint-disable-next-line no-console
      console.error("❌ Registration service error:", error);
    }
    return res.status(status).json({
      success: false,
      code: error instanceof AppError ? error.code : ErrorCodes.INTERNAL_ERROR,
      message,
    });
  }
});

// ---------------------------------------------------------------------------
// POST /api/v1/auth/login
// ---------------------------------------------------------------------------
const login = asyncHandler(async (req, res) => {
  let credentials;
  try {
    credentials = validateLogin(req.body);
  } catch (error) {
    return handleServiceError(error, res, "Invalid login credentials");
  }

  const deviceInfo = getDeviceInfo(req);

  try {
    const result = await authService.login(
      credentials.email,
      credentials.password,
      deviceInfo,
    );

    // For host users, compute verification status from the same formatter
    // used by GET /host-verification-status so the shape never drifts.
    let verificationStatus = null;
    if (result.user.role === "host") {
      verificationStatus = buildVerificationStatus(result.user);
    }

    return res.status(200).json({
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
        verificationStatus,
      },
    });
  } catch (error) {
    if (error instanceof AppError && error.code === ErrorCodes.EMAIL_NOT_VERIFIED) {
      const email = error.meta?.email || credentials.email;
      return res.status(403).json({
        success: false,
        code: ErrorCodes.EMAIL_NOT_VERIFIED,
        message: error.message,
        userData: error.meta?.userData || { email },
        resendLink: `/resend-verification?email=${encodeURIComponent(email)}`,
      });
    }

    if (error instanceof AppError) {
      return res.status(error.status).json({
        success: false,
        code: error.code,
        message: error.message,
      });
    }

    // eslint-disable-next-line no-console
    console.error("❌ Login service error:", error);
    return res.status(401).json({
      success: false,
      code: ErrorCodes.INVALID_CREDENTIALS,
      message: "Login failed",
    });
  }
});

// ---------------------------------------------------------------------------
// POST /api/v1/auth/logout
// ---------------------------------------------------------------------------
const logout = asyncHandler(async (req, res) => {
  const sessionId = req.body?.session_id || null;
  await authService.logout(req.user.id, sessionId);
  return res.status(200).json({ success: true, message: "Logged out successfully" });
});

// ---------------------------------------------------------------------------
// POST /api/v1/auth/refresh
// ---------------------------------------------------------------------------
const refreshToken = asyncHandler(async (req, res) => {
  const { refresh_token } = req.body || {};
  if (!refresh_token) {
    return res.status(400).json({
      success: false,
      code: ErrorCodes.INVALID_INPUT,
      message: "Refresh token is required",
    });
  }
  const tokens = await authService.refreshToken(refresh_token);
  return res.status(200).json({ success: true, data: { tokens } });
});

// ---------------------------------------------------------------------------
// GET /api/v1/auth/verify-email?token=...
// ---------------------------------------------------------------------------
const verifyEmail = asyncHandler(async (req, res) => {
  const frontendUrl = process.env.FRONTEND_URL || "https://mar-haba.ly";
  const resultBase = `${frontendUrl}/verification-result`;

  const redirectWith = (params) => {
    const qs = new URLSearchParams(params).toString();
    return res.redirect(`${resultBase}?${qs}`);
  };

  try {
    const { token } = req.query;

    if (!token) {
      return redirectWith({
        error: "invalid-token",
        message: "Invalid verification link. Please request a new one.",
      });
    }

    const result = await authService.verifyEmail(token);

    if (result.error === "token-expired") {
      return redirectWith({
        status: "expired",
        email: result.email || "",
        message: "Your verification link has expired. Please request a new one.",
      });
    }

    if (result.error === "already-verified") {
      return redirectWith({
        status: "already-verified",
        email: result.email || "",
        message: "Email is already verified. You can login now.",
      });
    }

    if (result.error === "invalid-token") {
      return redirectWith({
        error: "invalid-token",
        message: "Invalid verification link. Please request a new one.",
      });
    }

    if (result.success) {
      // Do NOT put name/role in the URL (PII in logs/referrer).
      // Pass a short-lived opaque code the frontend exchanges via /me.
      return redirectWith({
        status: "success",
        redirect: "/login",
      });
    }

    return redirectWith({
      error: "unknown",
      message: "Unable to verify your email. Please try again.",
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("❌ Email verification error:", error);
    return redirectWith({
      error: "server-error",
      message: "A server error occurred while verifying your email.",
    });
  }
});

// ---------------------------------------------------------------------------
// POST /api/v1/auth/resend-verification
// ---------------------------------------------------------------------------
const resendVerification = asyncHandler(async (req, res) => {
  let email;
  try {
    ({ email } = validateEmailOnly(req.body));
  } catch (error) {
    return handleServiceError(error, res, "Invalid email");
  }

  try {
    const result = await authService.resendVerificationEmail(email);
    return res.status(200).json({
      success: true,
      message: result.message,
      data: { tokenExpiry: result.tokenExpiry, email },
    });
  } catch (error) {
    if (error instanceof AppError) {
      return res.status(error.status).json({
        success: false,
        code: error.code,
        message: error.message,
      });
    }
    // eslint-disable-next-line no-console
    console.error("❌ Resend verification error:", error);
    return res.status(500).json({
      success: false,
      code: ErrorCodes.INTERNAL_ERROR,
      message: "Failed to resend verification email. Please try again.",
    });
  }
});

// ---------------------------------------------------------------------------
// GET /api/v1/auth/check-verification-status?email=...
// ---------------------------------------------------------------------------
const checkVerificationStatus = asyncHandler(async (req, res) => {
  let email;
  try {
    ({ email } = validateEmailOnly(req.query));
  } catch (error) {
    return handleServiceError(error, res, "Invalid email");
  }

  try {
    const status = await authService.checkVerificationStatus(email);
    return res.status(200).json({ success: true, data: status });
  } catch (error) {
    if (error instanceof AppError) {
      return res.status(error.status).json({
        success: false,
        code: error.code,
        message: error.message,
      });
    }
    // eslint-disable-next-line no-console
    console.error("❌ Check verification status error:", error);
    return res.status(500).json({
      success: false,
      code: ErrorCodes.INTERNAL_ERROR,
      message: "Failed to check verification status",
    });
  }
});

// ---------------------------------------------------------------------------
// POST /api/v1/auth/forgot-password
// ---------------------------------------------------------------------------
const forgotPassword = asyncHandler(async (req, res) => {
  let email;
  try {
    ({ email } = validateEmailOnly(req.body));
  } catch (error) {
    return handleServiceError(error, res, "Invalid email");
  }
  const result = await authService.requestPasswordReset(email);
  return res.status(200).json({ success: true, message: result.message });
});

// ---------------------------------------------------------------------------
// POST /api/v1/auth/reset-password/:token
// ---------------------------------------------------------------------------
const resetPassword = asyncHandler(async (req, res) => {
  const { token } = req.params;
  const { password } = req.body || {};

  if (!password || String(password).length < 8) {
    return res.status(400).json({
      success: false,
      code: ErrorCodes.VALIDATION_FAILED,
      message: "Password must be at least 8 characters",
    });
  }

  const result = await authService.resetPassword(token, password);
  return res.status(200).json({ success: true, message: result.message });
});

// ---------------------------------------------------------------------------
// GET /api/v1/auth/me
// ---------------------------------------------------------------------------
const getMe = asyncHandler(async (req, res) => {
  const user = await authService.getUserById(req.user.id);
  return res.status(200).json({
    success: true,
    data: { user: maskSensitiveData(user) },
  });
});

// ---------------------------------------------------------------------------
// PUT /api/v1/auth/me
// ---------------------------------------------------------------------------
const updateMe = asyncHandler(async (req, res) => {
  let updates;
  try {
    updates = validateUpdateMe(req.body);
  } catch (error) {
    return handleServiceError(error, res, "Invalid profile data");
  }

  // If nothing passed the whitelist, reject instead of silently no-op'ing
  if (Object.keys(updates).length === 0) {
    return res.status(400).json({
      success: false,
      code: ErrorCodes.VALIDATION_FAILED,
      message: "No updatable fields provided",
    });
  }

  const user = await authService.updateUser(req.user.id, updates);
  return res.status(200).json({
    success: true,
    message: "Profile updated successfully",
    data: { user: maskSensitiveData(user) },
  });
});

// ---------------------------------------------------------------------------
// POST /api/v1/auth/change-password
// ---------------------------------------------------------------------------
const changePassword = asyncHandler(async (req, res) => {
  let payload;
  try {
    payload = validateChangePassword(req.body);
  } catch (error) {
    return handleServiceError(error, res, "Invalid password data");
  }

  const result = await authService.changePassword(
    req.user.id,
    payload.current_password,
    payload.new_password,
  );
  return res.status(200).json({ success: true, message: result.message });
});

// ---------------------------------------------------------------------------
// POST /api/v1/auth/id-image
// ---------------------------------------------------------------------------
const addIdImage = asyncHandler(async (req, res) => {
  let payload;
  try {
    payload = validateAddIdImage(req.body);
  } catch (error) {
    return handleServiceError(error, res, "Invalid image payload");
  }

  // Route through the service layer — no direct Prisma in controllers.
  const user = await authService.addIdImage(req.user.id, payload.url);

  return res.status(200).json({
    success: true,
    message: "ID image added successfully",
    data: { user: maskSensitiveData(user) },
  });
});

// ---------------------------------------------------------------------------
// GET /api/v1/auth/host-verification-status
// ---------------------------------------------------------------------------
const HOST_VERIFICATION_PAGE_SIZE = 20;

const getHostVerificationStatus = asyncHandler(async (req, res) => {
  try {
    const userId = req.user.id;

    // Bounded pagination
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const take = HOST_VERIFICATION_PAGE_SIZE;
    const skip = (page - 1) * take;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        id_documents: {
          orderBy: { created_at: "desc" },
          take,
          skip,
        },
        host_subscription_payments: {
          orderBy: { created_at: "desc" },
          take,
          skip,
        },
      },
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        code: ErrorCodes.USER_NOT_FOUND,
        message: "User not found",
      });
    }

    // Non-host: return empty shape
    if (user.role !== "host") {
      return res.status(200).json({
        success: true,
        data: {
          id: {
            uploaded: false,
            documents: [],
            status: "pending",
            verified: false,
            verified_at: null,
            rejected: false,
            rejection_reason: null,
          },
          payment: {
            uploaded: false,
            status: "pending",
            amount: null,
            submitted_at: null,
            approved_at: null,
            rejected: false,
            rejection_reason: null,
            payment: null,
          },
          all_payments: [],
          overall_status: user.status,
          pagination: {
            page,
            pageSize: take,
            has_more_documents: false,
            has_more_payments: false,
          },
        },
      });
    }

    const verificationStatus = buildVerificationStatus(user);

    // NOTE: we removed the two .count() calls. They were:
    //   - failing at runtime (prisma.idDocument / hostSubscriptionPayment undefined)
    //   - not required for the response shape
    //   - the only place that needed them was the pagination metadata,
    //     and for that we can just say "has_more" based on whether the
    //     page came back full.
    const fetchedDocs = user.id_documents?.length || 0;
    const fetchedPayments = user.host_subscription_payments?.length || 0;

    return res.status(200).json({
      success: true,
      data: {
        ...verificationStatus,
        pagination: {
          page,
          pageSize: take,
          has_more_documents: fetchedDocs === take,
          has_more_payments: fetchedPayments === take,
        },
      },
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("❌ Error fetching host verification status:", error);
    return res.status(500).json({
      success: false,
      code: ErrorCodes.INTERNAL_ERROR,
      message: "Failed to fetch host verification status",
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