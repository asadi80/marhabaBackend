
const authService = require("../services/authService");
const { prisma } = require("../config/database");

// ============================================================
// SHARED AUTHENTICATION MIDDLEWARE
// ============================================================

const protectWithAuthType = (expectedAuthType) => {
  return async (req, res, next) => {
    const authorization = req.headers.authorization;

    if (!authorization || !authorization.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        code: "UNAUTHORIZED",
        message: "Not authorized to access this route",
      });
    }

    const token = authorization.slice(7).trim();

    if (!token) {
      return res.status(401).json({
        success: false,
        code: "TOKEN_INVALID",
        message: "Access token is required",
      });
    }

    try {
      const decoded = authService.verifyToken(token, "access");

      if (
        !decoded ||
        !decoded.id ||
        !decoded.sessionId ||
        typeof decoded.authVersion !== "number"
      ) {
        return res.status(401).json({
          success: false,
          code: "TOKEN_INVALID",
          message: "Invalid or expired access token",
        });
      }

      // Tokens must explicitly identify their authentication scope.
      // Old tokens without authType must be replaced by logging in again.
      if (decoded.authType !== expectedAuthType) {
        return res.status(403).json({
          success: false,
          code: "AUTH_TYPE_MISMATCH",
          message:
            expectedAuthType === "admin"
              ? "Administrator authentication is required"
              : "Public authentication is required",
        });
      }

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

      const now = new Date();

      if (
        !session ||
        !session.is_active ||
        session.user_id !== decoded.id ||
        (session.expires_at && session.expires_at <= now)
      ) {
        return res.status(401).json({
          success: false,
          code: "SESSION_INVALID",
          message: "Session has expired or been revoked. Please log in again.",
        });
      }

      const user = await prisma.user.findUnique({
        where: {
          id: decoded.id,
        },
        select: {
          id: true,
          name: true,
          email: true,
          phone_number: true,
          profile_image: true,
          role: true,
          account_type: true,
          status: true,
          status_reason: true,
          auth_version: true,
          deleted_at: true,
          email_verified_at: true,
          host_expiry_date: true,
          created_at: true,
        },
      });

      if (!user || user.deleted_at) {
        return res.status(401).json({
          success: false,
          code: "USER_NOT_FOUND",
          message: "Account not found or deleted",
        });
      }

      if (decoded.authVersion !== user.auth_version) {
        return res.status(401).json({
          success: false,
          code: "TOKEN_INVALID",
          message: "Your session is no longer valid. Please log in again.",
        });
      }

      if (user.status === "suspended" || user.status === "banned") {
        return res.status(403).json({
          success: false,
          code: "ACCOUNT_RESTRICTED",
          message: `Account is ${user.status}`,
        });
      }

      // Enforce account type and role against the database,
      // not merely against the token.
      if (expectedAuthType === "admin") {
        const isValidAdmin =
          ["admin", "super_admin"].includes(user.role) &&
          user.account_type === user.role &&
          user.status === "confirmed";

        if (!isValidAdmin) {
          return res.status(403).json({
            success: false,
            code: "ADMIN_ACCESS_DENIED",
            message: "A confirmed administrator account is required",
          });
        }
      } else {
        const isValidPublicUser =
          user.role === "user" &&
          ["traveler", "host"].includes(user.account_type);

        if (!isValidPublicUser) {
          return res.status(403).json({
            success: false,
            code: "PUBLIC_ACCESS_DENIED",
            message: "This account cannot use public authentication",
          });
        }
      }

      req.user = user;
      req.sessionId = session.id;
      req.authType = expectedAuthType;

      return next();
    } catch (error) {
      console.error("Authentication middleware error:", error);

      return res.status(401).json({
        success: false,
        code: "AUTHENTICATION_FAILED",
        message: "Not authorized to access this route",
      });
    }
  };
};

// ============================================================
// PUBLIC AND ADMIN PROTECTION
// ============================================================

const protectPublic = protectWithAuthType("public");
const protectAdmin = protectWithAuthType("admin");

// Backward compatibility: existing public routes using protect
// continue to require public authentication.
const protect = protectPublic;

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

    return next();
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

  return next();
};

// ============================================================
// CHECK HOST ACCOUNT TYPE
// ============================================================

const isHost = (req, res, next) => {
  if (
    req.user?.account_type !== "host" ||
    req.user?.role !== "user"
  ) {
    return res.status(403).json({
      success: false,
      message: "Host account required for this action",
    });
  }

  return next();
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
      const isAdmin = ["admin", "super_admin"].includes(req.user.role);

      if (ownerId !== req.user.id && !isAdmin) {
        return res.status(403).json({
          success: false,
          message: "Not authorized to access this resource",
        });
      }

      return next();
    } catch (error) {
      return next(error);
    }
  };
};

module.exports = {
  protect,
  protectPublic,
  protectAdmin,
  authorize,
  isVerified,
  isHost,
  checkOwnership,
};
