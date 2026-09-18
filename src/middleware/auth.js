//backend/src/middleware/auth
const authService = require('../services/authService');
const { prisma } = require('../config/database');

// Protect routes - require authentication
const protect = async (req, res, next) => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Not authorized to access this route',
    });
  }

  try {
    // SECURITY: explicitly require this to be an access token. Without
    // this, a refresh token (or, before the fix, a token signed with a
    // fallback shared secret) could be used directly as a Bearer token.
    const decoded = authService.verifyToken(token, 'access');

    if (!decoded) {
      return res.status(401).json({
        success: false,
        message: 'Invalid or expired token',
      });
    }

    // SECURITY: this is the important addition. Previously a valid JWT
    // signature was treated as sufficient — logout, password change, and
    // session revocation never actually invalidated an access token, so
    // a stolen token kept working for its full lifetime regardless.
    // Now we confirm the specific session the token was issued for is
    // still active before trusting it.
    if (decoded.sessionId) {
      const session = await prisma.userSession.findUnique({
        where: { id: decoded.sessionId },
        select: { is_active: true, user_id: true },
      });

      if (!session || !session.is_active || session.user_id !== decoded.id) {
        return res.status(401).json({
          success: false,
          message: 'Session has been revoked. Please log in again.',
        });
      }
    }

    const user = await prisma.user.findUnique({
      where: { id: decoded.id },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        status: true,
        email_verified: true,
      },
    });

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'User not found',
      });
    }

    if (user.status === 'suspended' || user.status === 'banned') {
      return res.status(403).json({
        success: false,
        message: `Account is ${user.status}`,
      });
    }

    req.user = user;
    req.sessionId = decoded.sessionId; // handy for logout(userId, req.sessionId)
    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: 'Not authorized to access this route',
    });
  }
};

// Restrict to specific roles
const authorize = (...roles) => {
  return (req, res, next) => {
    // Defensive check: authorize() should always run after protect(),
    // but if it's ever mounted without protect() this avoids a crash
    // (`Cannot read properties of undefined`) that could otherwise
    // produce a confusing 500 instead of a clean 401.
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Not authorized to access this route',
      });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `User role ${req.user.role} is not authorized to access this route`,
      });
    }
    next();
  };
};

// Check if user is verified (email verified)
const isVerified = (req, res, next) => {
  if (!req.user?.email_verified) {
    return res.status(403).json({
      success: false,
      message: 'Please verify your email first',
    });
  }
  next();
};

// Check if user is host
const isHost = (req, res, next) => {
  if (req.user?.role !== 'host' && req.user?.role !== 'admin') {
    return res.status(403).json({
      success: false,
      message: 'Host account required for this action',
    });
  }
  next();
};

// Check resource ownership
const checkOwnership = (model) => {
  return async (req, res, next) => {
    try {
      const resource = await model.findUnique({
        where: { id: req.params.id },
        select: { user_id: true, host_id: true },
      });

      if (!resource) {
        return res.status(404).json({
          success: false,
          message: 'Resource not found',
        });
      }

      const ownerId = resource.user_id || resource.host_id;
      if (ownerId !== req.user.id && req.user.role !== 'admin') {
        return res.status(403).json({
          success: false,
          message: 'Not authorized to access this resource',
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