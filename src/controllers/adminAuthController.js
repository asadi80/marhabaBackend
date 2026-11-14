
const authService = require("../services/authService");
const { asyncHandler } = require("../middleware/errorHandler");

// ============================================================
// DEVICE INFORMATION
// ============================================================

function getDeviceInfo(req) {
  return {
    device: req.headers["x-device-type"] || "desktop",
    browser: req.headers["x-browser"] || "unknown",
    os: req.headers["x-os"] || "unknown",
    ip:
      req.ip ||
      req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
      req.socket?.remoteAddress ||
      null,
    userAgent: req.headers["user-agent"] || null,
  };
}

// ============================================================
// ADMIN LOGIN
// POST /api/v1/admin/auth/login
// ============================================================

const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body || {};

  const result = await authService.loginAdmin(
    email,
    password,
    getDeviceInfo(req)
  );

  res.status(200).json({
    success: true,
    message: "Administrator login successful",
    user: result.user,
    tokens: result.tokens,
  });
});

// ============================================================
// ADMIN REFRESH
// POST /api/v1/admin/auth/refresh
// ============================================================

const refresh = asyncHandler(async (req, res) => {
  const refreshToken = req.body?.refreshToken;

  if (!refreshToken || typeof refreshToken !== "string") {
    return res.status(400).json({
      success: false,
      code: "TOKEN_INVALID",
      message: "Refresh token is required",
    });
  }

  const tokens = await authService.refreshAdminToken(refreshToken);

  res.status(200).json({
    success: true,
    message: "Token refreshed successfully",
    tokens,
  });
});

// ============================================================
// ADMIN LOGOUT
// POST /api/v1/admin/auth/logout
// ============================================================

const logout = asyncHandler(async (req, res) => {
  await authService.logout(req.user.id, req.sessionId);

  res.status(200).json({
    success: true,
    message: "Logged out successfully",
  });
});

// ============================================================
// CURRENT ADMIN
// GET /api/v1/admin/auth/me
// ============================================================

const me = asyncHandler(async (req, res) => {
  res.status(200).json({
    success: true,
    user: req.user,
  });
});

module.exports = {
  login,
  refresh,
  logout,
  me,
};
