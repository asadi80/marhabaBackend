// src/services/authService.js

const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { OAuth2Client } = require("google-auth-library");

const { prisma } = require("../config/database");
const { redisHelpers } = require("../config/redis");
const { AppError, ErrorCodes } = require("../utils/errors");
const { buildVerificationStatus } = require("./verificationFormatter");

// ============================================================
// CONFIGURATION
// ============================================================

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;

const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

const ACCESS_TOKEN_EXPIRES_IN = process.env.JWT_EXPIRE || "7d";
const REFRESH_TOKEN_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRE || "30d";

if (!process.env.JWT_SECRET || !process.env.JWT_REFRESH_SECRET) {
  throw new Error("JWT_SECRET and JWT_REFRESH_SECRET must both be configured.");
}

if (process.env.JWT_SECRET === process.env.JWT_REFRESH_SECRET) {
  throw new Error(
    "JWT_SECRET and JWT_REFRESH_SECRET must use different values.",
  );
}

// Public Google authentication supports only these account types.
const PUBLIC_ACCOUNT_TYPES = ["traveler", "host"];

// Only these fields can be changed through the public profile API.
const SELF_EDITABLE_USER_FIELDS = ["name", "phone_number", "profile_image"];

// Relations needed for Host verification information.
const AUTH_USER_INCLUDE = {
  id_documents: {
    orderBy: {
      created_at: "desc",
    },
  },
  host_subscription_payments: {
    orderBy: {
      created_at: "desc",
    },
  },
};

// ============================================================
// HELPERS
// ============================================================

function createAppError(code, message, status = 400) {
  return new AppError(code, message, status);
}

function isPrismaUniqueError(error) {
  return error && error.code === "P2002";
}

function safeJsonObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value;
}

function removePasswordHash(user) {
  if (!user) return user;

  const { password_hash, ...safeUser } = user;

  return safeUser;
}

function normalizeEmail(email) {
  return String(email || "")
    .trim()
    .toLowerCase();
}

function getDeviceData(deviceInfo = {}) {
  return {
    device: deviceInfo.device || "desktop",
    browser: deviceInfo.browser || "unknown",
    os: deviceInfo.os || "unknown",
    ip_address: deviceInfo.ip || null,
    user_agent: deviceInfo.userAgent || null,
  };
}

// ============================================================
// AUTH SERVICE
// ============================================================

class AuthService {
  // ==========================================================
  // HASH PASSWORD
  //
  // Kept for trusted authentication services that may use this
  // service internally. Public Traveler/Host auth is Google-only.
  // ==========================================================

  async hashPassword(password) {
    if (!password || typeof password !== "string") {
      throw createAppError(
        ErrorCodes.VALIDATION_FAILED,
        "Password is required",
        400,
      );
    }

    const salt = await bcrypt.genSalt(12);

    return bcrypt.hash(password, salt);
  }

  // ==========================================================
  // COMPARE PASSWORD
  // ==========================================================

  async comparePassword(password, hashedPassword) {
    if (!password || !hashedPassword) {
      return false;
    }

    return bcrypt.compare(password, hashedPassword);
  }

  // ==========================================================
  // GENERATE JWT TOKENS
  // ==========================================================

  generateTokens(userId, sessionId, authVersion = 0, authType = "public") {
    if (!["public", "admin"].includes(authType)) {
      throw createAppError(
        ErrorCodes.INVALID_INPUT,
        "Invalid authentication type",
        400,
      );
    }

    const payload = {
      id: userId,
      sessionId,
      authVersion,
      authType,
    };

    const accessToken = jwt.sign(
      {
        ...payload,
        type: "access",
      },
      process.env.JWT_SECRET,
      {
        expiresIn: ACCESS_TOKEN_EXPIRES_IN,
      },
    );

    const refreshToken = jwt.sign(
      {
        ...payload,
        type: "refresh",
      },
      process.env.JWT_REFRESH_SECRET,
      {
        expiresIn: REFRESH_TOKEN_EXPIRES_IN,
      },
    );

    return {
      accessToken,
      refreshToken,
    };
  }

  // ==========================================================
  // VERIFY JWT TOKEN
  // ==========================================================

  verifyToken(token, expectedType = "access") {
    if (!token || typeof token !== "string") {
      return null;
    }

    const secret =
      expectedType === "refresh"
        ? process.env.JWT_REFRESH_SECRET
        : process.env.JWT_SECRET;

    try {
      const decoded = jwt.verify(token, secret);

      if (decoded.type !== expectedType) {
        return null;
      }

      return decoded;
    } catch {
      return null;
    }
  }

  // ==========================================================
  // HASH REFRESH TOKEN
  // ==========================================================

  hashToken(token) {
    return crypto.createHash("sha256").update(token).digest("hex");
  }

  // ==========================================================
  // REDIS HELPERS
  // ==========================================================

  async clearUserCache(userId) {
    try {
      await redisHelpers.del(`user:${userId}`);
    } catch (error) {
      console.error("Failed to clear user cache:", error.message);
    }
  }

  async cacheUser(userId, user) {
    try {
      const safeUser = removePasswordHash(user);

      await redisHelpers.set(`user:${userId}`, safeUser, 3600);
    } catch (error) {
      console.error("Failed to cache user:", error.message);
    }
  }

  // ==========================================================
  // ADMIN LOGIN
  // ==========================================================

  async loginAdmin(email, password, deviceInfo = {}) {
    const normalizedEmail = normalizeEmail(email);

    if (!normalizedEmail || typeof password !== "string" || !password) {
      throw createAppError(
        ErrorCodes.INVALID_CREDENTIALS,
        "Invalid email or password",
        401,
      );
    }

    const user = await prisma.user.findUnique({
      where: {
        email: normalizedEmail,
      },
    });

    // Use the same generic error for all credential failures.
    if (
      !user ||
      user.deleted_at ||
      !["admin", "super_admin"].includes(user.role) ||
      user.account_type !== user.role ||
      !user.password_hash
    ) {
      throw createAppError(
        ErrorCodes.INVALID_CREDENTIALS,
        "Invalid email or password",
        401,
      );
    }

    if (user.status !== "confirmed") {
      throw createAppError(
        ErrorCodes.FORBIDDEN,
        "Administrator account is not active",
        403,
      );
    }

    const passwordMatches = await this.comparePassword(
      password,
      user.password_hash,
    );

    if (!passwordMatches) {
      throw createAppError(
        ErrorCodes.INVALID_CREDENTIALS,
        "Invalid email or password",
        401,
      );
    }

    const now = new Date();
    const deviceData = getDeviceData(deviceInfo);

    const result = await prisma.$transaction(async (tx) => {
      // Revoke previous sessions for this administrator.
      await tx.userSession.updateMany({
        where: {
          user_id: user.id,
          is_active: true,
        },
        data: {
          is_active: false,
          logged_out_at: now,
          refresh_token_hash: null,
        },
      });

      const session = await tx.userSession.create({
        data: {
          user_id: user.id,
          device: deviceData.device,
          browser: deviceData.browser,
          os: deviceData.os,
          ip_address: deviceData.ip_address,
          user_agent: deviceData.user_agent,
          is_active: true,
          logged_in_at: now,
        },
      });

      await tx.user.update({
        where: {
          id: user.id,
        },
        data: {
          last_login_at: now,
          last_active: now,
        },
      });

      return session;
    });

    const tokens = this.generateTokens(
      user.id,
      result.id,
      user.auth_version,
      "admin",
    );

    try {
      await prisma.userSession.update({
        where: {
          id: result.id,
        },
        data: {
          refresh_token_hash: this.hashToken(tokens.refreshToken),
        },
      });
    } catch (error) {
      await prisma.userSession.updateMany({
        where: {
          id: result.id,
          user_id: user.id,
        },
        data: {
          is_active: false,
          logged_out_at: new Date(),
          refresh_token_hash: null,
        },
      });

      throw createAppError(
        ErrorCodes.INTERNAL_ERROR,
        "Failed to create administrator session",
        500,
      );
    }

    try {
      await prisma.userEvent.create({
        data: {
          user_id: user.id,
          event_type: "admin_login",
          metadata: {
            role: user.role,
            ip: deviceData.ip_address,
            device: deviceData.device,
            browser: deviceData.browser,
            os: deviceData.os,
          },
        },
      });
    } catch (error) {
      console.error("Failed to record administrator login:", error.message);
    }

    const safeUser = {
      id: user.id,
      name: user.name,
      email: user.email,
      phone_number: user.phone_number,
      profile_image: user.profile_image,
      role: user.role,
      account_type: user.account_type,
      status: user.status,
      email_verified_at: user.email_verified_at,
      created_at: user.created_at,
    };

    return {
      user: safeUser,
      tokens,
    };
  }

  // ==========================================================
  // GOOGLE LOGIN / SIGNUP
  //
  // SIGNUP:
  // {
  //   intent: "signup",
  //   accountType: "traveler" | "host"
  // }
  //
  // LOGIN:
  // {
  //   intent: "login"
  // }
  //
  // IMPORTANT:
  // - Public Google auth is only for Travelers and Hosts.
  // - Login never creates an account.
  // - Signup never logs in an existing account.
  // - Existing account_type is never changed during login.
  // - Admin and Super Admin cannot use this endpoint.
  // ==========================================================

  async loginWithGoogle(idToken, authRequest = {}, deviceInfo = {}) {
    // --------------------------------------------------------
    // 1. Validate configuration and request
    // --------------------------------------------------------

    if (!GOOGLE_CLIENT_ID) {
      throw createAppError(
        ErrorCodes.INTERNAL_ERROR,
        "Google authentication is not configured",
        500,
      );
    }

    if (!idToken || typeof idToken !== "string") {
      throw createAppError(
        ErrorCodes.VALIDATION_FAILED,
        "Google ID token is required",
        400,
      );
    }

    if (
      !authRequest ||
      typeof authRequest !== "object" ||
      Array.isArray(authRequest)
    ) {
      throw createAppError(
        ErrorCodes.VALIDATION_FAILED,
        "Invalid authentication request",
        400,
      );
    }

    const { intent, accountType } = authRequest;

    if (!["login", "signup"].includes(intent)) {
      throw createAppError(
        ErrorCodes.VALIDATION_FAILED,
        "Invalid authentication intent",
        400,
      );
    }

    if (intent === "signup" && !PUBLIC_ACCOUNT_TYPES.includes(accountType)) {
      throw createAppError(
        ErrorCodes.VALIDATION_FAILED,
        "Invalid account type. Choose traveler or host.",
        400,
      );
    }

    if (intent === "login" && accountType !== undefined) {
      throw createAppError(
        ErrorCodes.VALIDATION_FAILED,
        "Account type must not be provided during login",
        400,
      );
    }

    // --------------------------------------------------------
    // 2. Verify Google identity
    // --------------------------------------------------------

    let googlePayload;

    try {
      const ticket = await googleClient.verifyIdToken({
        idToken,
        audience: GOOGLE_CLIENT_ID,
      });

      googlePayload = ticket.getPayload();
    } catch (error) {
      throw createAppError(
        ErrorCodes.INVALID_CREDENTIALS,
        "Invalid Google authentication token",
        401,
      );
    }

    if (
      !googlePayload ||
      !googlePayload.sub ||
      !googlePayload.email ||
      googlePayload.email_verified !== true
    ) {
      throw createAppError(
        ErrorCodes.INVALID_CREDENTIALS,
        "A verified Google email address is required",
        401,
      );
    }

    const googleId = googlePayload.sub;
    const email = normalizeEmail(googlePayload.email);
    const now = new Date();

    // --------------------------------------------------------
    // 3. Find account by Google ID
    // --------------------------------------------------------

    let user = await prisma.user.findUnique({
      where: {
        google_id: googleId,
      },
      include: AUTH_USER_INCLUDE,
    });

    let isNewUser = false;

    // ========================================================
    // 4. SIGNUP
    //
    // Signup must create a completely new account.
    // It must not silently log in an existing account.
    // ========================================================

    if (intent === "signup") {
      if (user) {
        throw createAppError(
          ErrorCodes.VALIDATION_FAILED,
          "This Google account is already registered. Please log in instead.",
          409,
        );
      }

      const existingEmailUser = await prisma.user.findUnique({
        where: {
          email,
        },
      });

      if (existingEmailUser) {
        throw createAppError(
          ErrorCodes.VALIDATION_FAILED,
          "An account with this email already exists. Please log in instead.",
          409,
        );
      }

      try {
        user = await prisma.user.create({
          data: {
            name: googlePayload.name || email.split("@")[0],

            email,

            google_id: googleId,

            profile_image: googlePayload.picture || null,

            email_verified_at: now,

            password_hash: null,

            phone_number: null,

            account_type: accountType,

            role: "user",

            // Hosts must be allowed to log in while pending.
            status: accountType === "host" ? "pending" : "active",

            last_login_at: now,

            last_active: now,

            host_details: {
              rating: 0,
              totalListings: 0,
              verified: false,
              id_verified: false,
              id_verified_at: null,
              id_rejected: false,
              id_rejection_reason: null,
              payment_verified: false,
              payment_verified_at: null,
              payment_rejected: false,
              payment_rejection_reason: null,
              notificationSent: {
                oneWeek: false,
                twoDays: false,
              },
            },

            user_details: {
              preferences: {},
              bookings: [],
            },
          },

          include: AUTH_USER_INCLUDE,
        });

        isNewUser = true;
      } catch (error) {
        // Handle concurrent signup attempts and unique conflicts.
        if (isPrismaUniqueError(error)) {
          throw createAppError(
            ErrorCodes.VALIDATION_FAILED,
            "An account with this Google account or email already exists. Please log in instead.",
            409,
          );
        }

        throw error;
      }
    }

    // ========================================================
    // 5. LOGIN
    //
    // Login must never create a new account.
    // ========================================================

    if (intent === "login") {
      // ------------------------------------------------------
      // 5A. Find account by verified email if Google ID
      //     has not been linked yet.
      // ------------------------------------------------------

      if (!user) {
        const existingEmailUser = await prisma.user.findUnique({
          where: {
            email,
          },
          include: AUTH_USER_INCLUDE,
        });

        if (!existingEmailUser) {
          throw createAppError(
            ErrorCodes.INVALID_CREDENTIALS,
            "No account was found for this Google account. Please sign up first.",
            404,
          );
        }

        if (existingEmailUser.deleted_at) {
          throw createAppError(
            ErrorCodes.FORBIDDEN,
            "This account is no longer available",
            403,
          );
        }

        // Never link an Admin or Super Admin through public Google.
        if (
          ["admin", "super_admin"].includes(existingEmailUser.account_type) ||
          existingEmailUser.role !== "user"
        ) {
          throw createAppError(
            ErrorCodes.FORBIDDEN,
            "Please use the administrator login",
            403,
          );
        }

        if (!PUBLIC_ACCOUNT_TYPES.includes(existingEmailUser.account_type)) {
          throw createAppError(
            ErrorCodes.FORBIDDEN,
            "This account cannot use public Google authentication",
            403,
          );
        }

        if (
          existingEmailUser.google_id &&
          existingEmailUser.google_id !== googleId
        ) {
          throw createAppError(
            ErrorCodes.INVALID_CREDENTIALS,
            "This email is already linked to another Google account",
            409,
          );
        }

        // ----------------------------------------------------
        // 5B. Link Google ID to the existing eligible account.
        //
        // Never change:
        // - account_type
        // - role
        // - status
        // ----------------------------------------------------

        if (!existingEmailUser.google_id) {
          const linkResult = await prisma.user.updateMany({
            where: {
              id: existingEmailUser.id,
              google_id: null,
              role: "user",
              account_type: {
                in: PUBLIC_ACCOUNT_TYPES,
              },
              deleted_at: null,
            },

            data: {
              google_id: googleId,

              email_verified_at: existingEmailUser.email_verified_at || now,

              profile_image:
                existingEmailUser.profile_image ||
                googlePayload.picture ||
                null,
            },
          });

          if (linkResult.count !== 1) {
            throw createAppError(
              ErrorCodes.INVALID_CREDENTIALS,
              "Unable to link this Google account. Please try logging in again.",
              409,
            );
          }
        }

        user = await prisma.user.findUnique({
          where: {
            id: existingEmailUser.id,
          },
          include: AUTH_USER_INCLUDE,
        });
      }
    }

    // ========================================================
    // 6. Validate the account before creating a session
    // ========================================================

    if (!user || user.deleted_at) {
      throw createAppError(
        ErrorCodes.FORBIDDEN,
        "This account is no longer available",
        403,
      );
    }

    // Public Google authentication must never authenticate
    // administrators, regardless of their account_type.
    if (
      ["admin", "super_admin"].includes(user.account_type) ||
      user.role !== "user"
    ) {
      throw createAppError(
        ErrorCodes.FORBIDDEN,
        "Please use the administrator login",
        403,
      );
    }

    if (!PUBLIC_ACCOUNT_TYPES.includes(user.account_type)) {
      throw createAppError(
        ErrorCodes.FORBIDDEN,
        "This account cannot use public Google authentication",
        403,
      );
    }

    if (user.status === "suspended" || user.status === "banned") {
      throw createAppError(
        ErrorCodes.FORBIDDEN,
        `Your account is ${user.status}`,
        403,
      );
    }

    // Pending Hosts are intentionally allowed to log in.

    // ========================================================
    // 7. Build Host verification information
    // ========================================================

    let loginMessage = "Login successful";

    let requiresIdUpload = false;

    let isHostApproved = true;

    if (user.account_type === "host") {
      const documents = user.id_documents || [];

      const hasApprovedId = documents.some((doc) => doc.status === "approved");

      const hasPendingId = documents.some((doc) => doc.status === "pending");

      const hasRejectedId = documents.some((doc) => doc.status === "rejected");

      if (user.status !== "confirmed") {
        isHostApproved = false;

        if (!documents.length) {
          requiresIdUpload = true;

          loginMessage =
            "Please upload your ID/Passport to complete verification.";
        } else if (hasRejectedId && !hasApprovedId) {
          requiresIdUpload = true;

          loginMessage =
            "Your ID/Passport was rejected. Please upload a new document.";
        } else if (hasPendingId && !hasApprovedId) {
          loginMessage = "Your ID/Passport is pending admin verification.";
        } else {
          loginMessage = "Your host account is pending admin approval.";
        }
      }
    }

    // ========================================================
    // 8. Update login timestamps
    // ========================================================

    user = await prisma.user.update({
      where: {
        id: user.id,
      },

      data: {
        last_login_at: now,
        last_active: now,
      },

      include: AUTH_USER_INCLUDE,
    });

    // ========================================================
    // 9. Revoke previous sessions and create a new one
    //
    // Use a transaction so that old sessions are revoked
    // and the new session is created together.
    // ========================================================

    const deviceData = getDeviceData(deviceInfo);

    const session = await prisma.$transaction(async (tx) => {
      await tx.userSession.updateMany({
        where: {
          user_id: user.id,
          is_active: true,
        },

        data: {
          is_active: false,
          logged_out_at: now,
          refresh_token_hash: null,
        },
      });

      return tx.userSession.create({
        data: {
          user_id: user.id,

          device: deviceData.device,

          browser: deviceData.browser,

          os: deviceData.os,

          ip_address: deviceData.ip_address,

          user_agent: deviceData.user_agent,

          is_active: true,

          logged_in_at: now,
        },
      });
    });

    // ========================================================
    // 10. Generate tokens
    //
    // auth_version is included in both JWTs.
    // Middleware must compare it against the database value.
    // ========================================================

    const tokens = this.generateTokens(user.id, session.id, user.auth_version);

    // ========================================================
    // 11. Save refresh token hash
    // ========================================================

    try {
      await prisma.userSession.update({
        where: {
          id: session.id,
        },

        data: {
          refresh_token_hash: this.hashToken(tokens.refreshToken),
        },
      });
    } catch (error) {
      await prisma.userSession.updateMany({
        where: {
          id: session.id,
          user_id: user.id,
        },

        data: {
          is_active: false,
          logged_out_at: new Date(),
          refresh_token_hash: null,
        },
      });

      throw createAppError(
        ErrorCodes.INTERNAL_ERROR,
        "Failed to create authenticated session",
        500,
      );
    }

    // ========================================================
    // 12. Record authentication event
    // ========================================================

    try {
      await prisma.userEvent.create({
        data: {
          user_id: user.id,

          event_type: isNewUser ? "signup" : "login",

          metadata: {
            provider: "google",
            account_type: user.account_type,
            ip: deviceData.ip_address,
            device: deviceData.device,
            browser: deviceData.browser,
            os: deviceData.os,
          },
        },
      });
    } catch (error) {
      console.error("Failed to log Google authentication:", error.message);
    }

    // ========================================================
    // 13. Prepare safe response
    // ========================================================

    const safeUser = removePasswordHash(user);

    const enrichedUser = {
      ...safeUser,

      requiresIdUpload,

      isHostApproved,

      loginMessage,
    };

    if (user.account_type === "host") {
      enrichedUser.verificationStatus = buildVerificationStatus(user);
    }

    // Cache the complete safe user, not a reduced user object.
    await this.cacheUser(user.id, enrichedUser);

    // ========================================================
    // 14. Return
    // ========================================================

    return {
      user: enrichedUser,
      tokens,
      isNewUser,
    };
  }

  // ==========================================================
  // LOGOUT
  // ==========================================================

  async logout(userId, sessionId = null) {
    const now = new Date();

    if (sessionId) {
      // Ensure the session belongs to this user.
      await prisma.userSession.updateMany({
        where: {
          id: sessionId,
          user_id: userId,
          is_active: true,
        },

        data: {
          is_active: false,
          logged_out_at: now,
          refresh_token_hash: null,
        },
      });
    } else {
      await prisma.userSession.updateMany({
        where: {
          user_id: userId,
          is_active: true,
        },

        data: {
          is_active: false,
          logged_out_at: now,
          refresh_token_hash: null,
        },
      });
    }

    await this.clearUserCache(userId);

    return {
      message: "Logged out successfully",
    };
  }

  // ==========================================================
  // REFRESH TOKEN
  //
  // - Validates JWT signature and type.
  // - Validates session ownership and status.
  // - Validates auth_version.
  // - Detects refresh-token reuse.
  // - Rotates refresh tokens.
  // ==========================================================

  // ==========================================================
  // PUBLIC REFRESH
  // ==========================================================

  async refreshToken(refreshToken) {
    return this.refreshTokenForScope(refreshToken, "public");
  }

  // ==========================================================
  // ADMIN REFRESH
  // ==========================================================

  async refreshAdminToken(refreshToken) {
    return this.refreshTokenForScope(refreshToken, "admin");
  }

  // ==========================================================
  // SHARED REFRESH IMPLEMENTATION
  // ==========================================================

  async refreshTokenForScope(refreshToken, expectedAuthType) {
    const decoded = this.verifyToken(refreshToken, "refresh");

    if (
      !decoded ||
      !decoded.id ||
      !decoded.sessionId ||
      typeof decoded.authVersion !== "number" ||
      decoded.authType !== expectedAuthType
    ) {
      throw createAppError(
        ErrorCodes.TOKEN_INVALID,
        "Invalid refresh token",
        401,
      );
    }

    const session = await prisma.userSession.findUnique({
      where: {
        id: decoded.sessionId,
      },
    });

    if (
      !session ||
      !session.is_active ||
      session.user_id !== decoded.id ||
      (session.expires_at && session.expires_at <= new Date())
    ) {
      throw createAppError(
        ErrorCodes.TOKEN_INVALID,
        "Session has been revoked or expired",
        401,
      );
    }

    const user = await prisma.user.findUnique({
      where: {
        id: decoded.id,
      },
    });

    if (!user || user.deleted_at) {
      throw createAppError(
        ErrorCodes.USER_NOT_FOUND,
        "User not found or deleted",
        401,
      );
    }

    if (decoded.authVersion !== user.auth_version) {
      throw createAppError(
        ErrorCodes.TOKEN_INVALID,
        "Session is no longer valid. Please log in again.",
        401,
      );
    }

    if (user.status === "suspended" || user.status === "banned") {
      throw createAppError(
        ErrorCodes.FORBIDDEN,
        `Account is ${user.status}`,
        403,
      );
    }

    if (expectedAuthType === "admin") {
      if (
        !["admin", "super_admin"].includes(user.role) ||
        user.account_type !== user.role ||
        user.status !== "confirmed"
      ) {
        throw createAppError(
          ErrorCodes.FORBIDDEN,
          "Administrator access is no longer available",
          403,
        );
      }
    } else {
      if (
        !PUBLIC_ACCOUNT_TYPES.includes(user.account_type) ||
        user.role !== "user"
      ) {
        throw createAppError(
          ErrorCodes.FORBIDDEN,
          "This account cannot use public authentication",
          403,
        );
      }
    }

    const oldTokenHash = this.hashToken(refreshToken);

    if (
      !session.refresh_token_hash ||
      session.refresh_token_hash !== oldTokenHash
    ) {
      // Do not revoke the session merely because a token was
      // presented to the wrong authentication endpoint.
      // At this point the scope matches, so a hash mismatch
      // indicates token reuse or an invalid rotation.
      await prisma.userSession.updateMany({
        where: {
          id: session.id,
          user_id: user.id,
          is_active: true,
        },
        data: {
          is_active: false,
          logged_out_at: new Date(),
          refresh_token_hash: null,
        },
      });

      await this.clearUserCache(user.id);

      throw createAppError(
        ErrorCodes.TOKEN_INVALID,
        "Refresh token reuse detected. Session revoked.",
        401,
      );
    }

    const newTokens = this.generateTokens(
      user.id,
      session.id,
      user.auth_version,
      expectedAuthType,
    );

    const rotationResult = await prisma.userSession.updateMany({
      where: {
        id: session.id,
        user_id: user.id,
        is_active: true,
        refresh_token_hash: oldTokenHash,
      },
      data: {
        refresh_token_hash: this.hashToken(newTokens.refreshToken),
      },
    });

    if (rotationResult.count !== 1) {
      throw createAppError(
        ErrorCodes.TOKEN_INVALID,
        "Refresh token is no longer valid. Please log in again.",
        401,
      );
    }

    return newTokens;
  }

  // ==========================================================
  // GET USER BY ID
  // ==========================================================

  async getUserById(userId) {
    // Query the database to avoid returning an incomplete or
    // outdated cached user object.
    const user = await prisma.user.findFirst({
      where: {
        id: userId,
        deleted_at: null,
      },

      include: {
        listings: {
          where: {
            is_active: true,
          },

          take: 5,

          orderBy: {
            created_at: "desc",
          },
        },

        bookings: {
          take: 5,

          orderBy: {
            created_at: "desc",
          },
        },

        id_documents: {
          orderBy: {
            created_at: "desc",
          },
        },
      },
    });

    if (!user) {
      throw createAppError(ErrorCodes.USER_NOT_FOUND, "User not found", 404);
    }

    const safeUser = removePasswordHash(user);

    await this.cacheUser(userId, safeUser);

    return safeUser;
  }

  // ==========================================================
  // UPDATE USER
  //
  // Publicly editable fields:
  // - name
  // - phone_number
  // - profile_image
  //
  // Never allow public users to update:
  // - role
  // - account_type
  // - status
  // - auth_version
  // - password_hash
  // - google_id
  // ==========================================================

  async updateUser(userId, updateData) {
    if (
      !updateData ||
      typeof updateData !== "object" ||
      Array.isArray(updateData)
    ) {
      throw createAppError(
        ErrorCodes.VALIDATION_FAILED,
        "Invalid update data",
        400,
      );
    }

    const safeData = {};

    for (const key of SELF_EDITABLE_USER_FIELDS) {
      if (updateData[key] !== undefined) {
        safeData[key] = updateData[key];
      }
    }

    // Validate name.
    if (safeData.name !== undefined) {
      if (typeof safeData.name !== "string" || !safeData.name.trim()) {
        throw createAppError(
          ErrorCodes.VALIDATION_FAILED,
          "Name must be a non-empty string",
          400,
        );
      }

      safeData.name = safeData.name.trim();
    }

    // Validate phone number.
    if (safeData.phone_number !== undefined) {
      if (
        safeData.phone_number !== null &&
        typeof safeData.phone_number !== "string"
      ) {
        throw createAppError(
          ErrorCodes.VALIDATION_FAILED,
          "Invalid phone number",
          400,
        );
      }

      if (typeof safeData.phone_number === "string") {
        safeData.phone_number = safeData.phone_number.trim() || null;
      }
    }

    // Validate profile image.
    if (safeData.profile_image !== undefined) {
      if (
        safeData.profile_image !== null &&
        typeof safeData.profile_image !== "string"
      ) {
        throw createAppError(
          ErrorCodes.VALIDATION_FAILED,
          "Invalid profile image",
          400,
        );
      }
    }

    if (Object.keys(safeData).length === 0) {
      throw createAppError(
        ErrorCodes.VALIDATION_FAILED,
        "No valid updatable fields provided",
        400,
      );
    }

    const user = await prisma.user.update({
      where: {
        id: userId,
      },

      data: safeData,
    });

    await this.clearUserCache(userId);

    return removePasswordHash(user);
  }

  // ==========================================================
  // ADD HOST ID DOCUMENT
  //
  // Stores a UserIdDocument record.
  // ==========================================================

  async addIdImage(userId, url) {
    if (!url || typeof url !== "string") {
      throw createAppError(
        ErrorCodes.VALIDATION_FAILED,
        "Document URL is required",
        400,
      );
    }

    let parsedUrl;

    try {
      parsedUrl = new URL(url);
    } catch {
      throw createAppError(
        ErrorCodes.VALIDATION_FAILED,
        "Invalid document URL",
        400,
      );
    }

    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      throw createAppError(
        ErrorCodes.VALIDATION_FAILED,
        "Document URL must use HTTP or HTTPS",
        400,
      );
    }

    const user = await prisma.user.findUnique({
      where: {
        id: userId,
      },

      select: {
        id: true,
        account_type: true,
        role: true,
        deleted_at: true,
      },
    });

    if (!user || user.deleted_at) {
      throw createAppError(ErrorCodes.USER_NOT_FOUND, "User not found", 404);
    }

    if (user.account_type !== "host" || user.role !== "user") {
      throw createAppError(
        ErrorCodes.FORBIDDEN,
        "Only Host accounts can upload identity documents",
        403,
      );
    }

    const document = await prisma.userIdDocument.create({
      data: {
        user_id: userId,
        document_type: "national_id",
        side: "front",
        file_url: url,
        status: "pending",
      },
    });

    await this.clearUserCache(userId);

    return document;
  }

  // ==========================================================
  // CREATE HOST PROFILE
  //
  // Converts an existing Traveler account into a Host.
  //
  // - Only Traveler accounts can become Hosts.
  // - Role remains "user".
  // - Account type becomes "host".
  // - Status becomes "pending".
  // - auth_version increments exactly once.
  // - Existing sessions are revoked.
  // ==========================================================

  async createHostProfile(userId, hostData = {}) {
    if (!hostData || typeof hostData !== "object" || Array.isArray(hostData)) {
      throw createAppError(
        ErrorCodes.VALIDATION_FAILED,
        "Invalid host profile data",
        400,
      );
    }

    const user = await prisma.user.findUnique({
      where: {
        id: userId,
      },
    });

    if (!user || user.deleted_at) {
      throw createAppError(ErrorCodes.USER_NOT_FOUND, "User not found", 404);
    }

    if (user.account_type === "host") {
      throw createAppError(
        ErrorCodes.VALIDATION_FAILED,
        "User is already a host",
        400,
      );
    }

    if (user.account_type !== "traveler" || user.role !== "user") {
      throw createAppError(
        ErrorCodes.FORBIDDEN,
        "This account cannot become a host",
        403,
      );
    }

    // Do not accept protected verification fields from the user.
    const {
      idImages,
      verified,
      id_verified,
      id_verified_at,
      id_rejected,
      id_rejection_reason,
      payment_verified,
      payment_verified_at,
      payment_rejected,
      payment_rejection_reason,
      rating,
      totalListings,
      notificationSent,
      ...safeHostData
    } = hostData;

    const currentHostDetails = safeJsonObject(user.host_details);

    const updatedHostDetails = {
      ...currentHostDetails,
      ...safeHostData,

      // These fields are controlled by the application/admin.
      rating: 0,
      totalListings: 0,
      verified: false,
      id_verified: false,
      id_verified_at: null,
      id_rejected: false,
      id_rejection_reason: null,
      payment_verified: false,
      payment_verified_at: null,
      payment_rejected: false,
      payment_rejection_reason: null,

      notificationSent: {
        oneWeek: false,
        twoDays: false,
      },
    };

    const now = new Date();

    // Use a transaction and conditional update to prevent two
    // simultaneous requests from converting the same account.
    const updatedUser = await prisma.$transaction(async (tx) => {
      const result = await tx.user.updateMany({
        where: {
          id: userId,
          account_type: "traveler",
          role: "user",
          deleted_at: null,
        },

        data: {
          account_type: "host",
          role: "user",
          status: "pending",

          // Increment exactly once.
          auth_version: {
            increment: 1,
          },

          host_details: updatedHostDetails,
        },
      });

      if (result.count !== 1) {
        throw createAppError(
          ErrorCodes.VALIDATION_FAILED,
          "Unable to convert this account into a Host. Please refresh and try again.",
          409,
        );
      }

      // Revoke existing Traveler sessions.
      await tx.userSession.updateMany({
        where: {
          user_id: userId,
          is_active: true,
        },

        data: {
          is_active: false,
          logged_out_at: now,
          refresh_token_hash: null,
        },
      });

      return tx.user.findUnique({
        where: {
          id: userId,
        },
      });
    });

    await this.clearUserCache(userId);

    // Return a safe user object.
    return removePasswordHash(updatedUser);
  }
}

// ============================================================
// EXPORT SERVICE
// ============================================================

module.exports = new AuthService();
