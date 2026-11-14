
const authService = require("../services/authService");
const { prisma } = require("../config/database");

// ============================================================
// PROTECT ROUTES
// ============================================================

const protect = async (req, res, next) => {
  let token;

  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith("Bearer ")
  ) {
    token = req.headers.authorization.split(" ")[1];
  }

  if (!token) {
    return res.status(401).json({
      success: false,
      message: "Not authorized to access this route",
    });
  }

  try {
    // Only access tokens are accepted.
    const decoded = authService.verifyToken(token, "access");

    if (!decoded) {
      return res.status(401).json({
        success: false,
        message: "Invalid or expired token",
      });
    }

    // Every protected user token must belong to a session.
    if (!decoded.sessionId) {
      return res.status(401).json({
        success: false,
        message: "Invalid session. Please log in again.",
      });
    }

    // Load the session and verify that it is still active.
    const session = await prisma.userSession.findUnique({
      where: {
        id: decoded.sessionId,
      },
      select: {
        id: true,
        user_id: true,
        is_active: true,
        expires_at: true,
      },
    });

    if (
      !session ||
      !session.is_active ||
      session.user_id !== decoded.id ||
      (session.expires_at && session.expires_at <= new Date())
    ) {
      return res.status(401).json({
        success: false,
        message: "Session has expired or been revoked. Please log in again.",
      });
    }

    // Load the current account from the database.
    const user = await prisma.user.findUnique({
      where: {
        id: decoded.id,
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        account_type: true,
        status: true,
        auth_version: true,
        deleted_at: true,
        email_verified_at: true,
      },
    });

    if (!user || user.deleted_at) {
      return res.status(401).json({
        success: false,
        message: "Account not found or deleted",
      });
    }

    // Reject tokens issued before the user's auth_version changed.
    // The token generator must include authVersion.
    if (
      typeof decoded.authVersion !== "number" ||
      decoded.authVersion !== user.auth_version
    ) {
      return res.status(401).json({
        success: false,
        message: "Your session is no longer valid. Please log in again.",
      });
    }

    if (user.status === "suspended" || user.status === "banned") {
      return res.status(403).json({
        success: false,
        message: `Account is ${user.status}`,
      });
    }

    // Attach the authenticated user.
    req.user = user;
    req.sessionId = session.id;

    next();
  } catch (error) {
    console.error("Authentication middleware error:", error);

    return res.status(401).json({
      success: false,
      message: "Not authorized to access this route",
    });
  }
};

// ============================================================
// AUTHORIZE BY ROLE
// ============================================================

const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Not authorized to access this route",
      });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `User role ${req.user.role} is not authorized`,
      });
    }

    next();
  };
};

// ============================================================
// CHECK GOOGLE EMAIL VERIFICATION
// ============================================================

const isVerified = (req, res, next) => {
  if (!req.user?.email_verified_at) {
    return res.status(403).json({
      success: false,
      message: "Please verify your email first",
    });
  }

  next();
};

// ============================================================
// CHECK HOST ACCOUNT TYPE
// ============================================================

const isHost = (req, res, next) => {
  if (req.user?.account_type !== "host") {
    return res.status(403).json({
      success: false,
      message: "Host account required for this action",
    });
  }

  next();
};

// ============================================================
// CHECK RESOURCE OWNERSHIP
// ============================================================

const checkOwnership = (model) => {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          message: "Not authorized to access this route",
        });
      }

      const resource = await model.findUnique({
        where: {
          id: req.params.id,
        },
        select: {
          user_id: true,
          host_id: true,
        },
      });

      if (!resource) {
        return res.status(404).json({
          success: false,
          message: "Resource not found",
        });
      }

      const ownerId = resource.user_id || resource.host_id;

      const isAdmin =
        req.user.role === "admin" &&
        ["admin", "super_admin"].includes(req.user.account_type);

      if (ownerId !== req.user.id && !isAdmin) {
        return res.status(403).json({
          success: false,
          message: "Not authorized to access this resource",
        });
      }

      next();
    } catch (error) {
      next(error);
    }
  };
};

module.exports = {
  protect,
  authorize,
  isVerified,
  isHost,
  checkOwnership,
};
