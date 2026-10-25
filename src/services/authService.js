// src/services/authService.js
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { prisma } = require("../config/database");
const { redisHelpers } = require("../config/redis");
const emailService = require("./emailService");
const { generateToken } = require("../utils/helpers");
const { USER_STATUS } = require("../utils/constants");
const { AppError, ErrorCodes } = require("../utils/errors");
const { buildVerificationStatus } = require("./verificationFormatter");

// Fail fast if secrets are missing (kept from your file).
if (!process.env.JWT_SECRET || !process.env.JWT_REFRESH_SECRET) {
  throw new Error(
    "JWT_SECRET and JWT_REFRESH_SECRET must both be set (and must be different values).",
  );
}

const SELF_ASSIGNABLE_ROLES = ["user", "host"];

// Fields a user is allowed to self-edit via PUT /auth/me.
// Defense-in-depth: the controller also whitelists, but the service
// must never trust its caller.
const SELF_EDITABLE_USER_FIELDS = [
  "name",
  "phone_number",
  "avatar_url",
  "bio",
  "locale",
];

const ACCESS_TOKEN_EXPIRES_IN = process.env.JWT_EXPIRE || "15m";
const REFRESH_TOKEN_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRE || "7d";

class AuthService {
  // ============================================================
  // HASH PASSWORD
  // ============================================================
  async hashPassword(password) {
    const salt = await bcrypt.genSalt(12);
    return bcrypt.hash(password, salt);
  }

  // ============================================================
  // COMPARE PASSWORD
  // ============================================================
  async comparePassword(password, hashedPassword) {
    return bcrypt.compare(password, hashedPassword);
  }

  // ============================================================
  // GENERATE JWT TOKENS
  // ============================================================
  generateTokens(userId, sessionId) {
    const accessToken = jwt.sign(
      { id: userId, sessionId, type: "access" },
      process.env.JWT_SECRET,
      { expiresIn: ACCESS_TOKEN_EXPIRES_IN },
    );

    const refreshToken = jwt.sign(
      { id: userId, sessionId, type: "refresh" },
      process.env.JWT_REFRESH_SECRET,
      { expiresIn: REFRESH_TOKEN_EXPIRES_IN },
    );

    return { accessToken, refreshToken };
  }

  // ============================================================
  // VERIFY TOKEN
  // ============================================================
  verifyToken(token, expectedType = "access") {
    const secret =
      expectedType === "refresh"
        ? process.env.JWT_REFRESH_SECRET
        : process.env.JWT_SECRET;

    try {
      const decoded = jwt.verify(token, secret);
      if (decoded.type !== expectedType) return null;
      return decoded;
    } catch {
      return null;
    }
  }

  // ============================================================
  // HASH A REFRESH TOKEN FOR STORAGE
  // ============================================================
  hashToken(token) {
    return crypto.createHash("sha256").update(token).digest("hex");
  }

  // ============================================================
  // REGISTER USER
  // ============================================================
  async register(userData, deviceInfo = {}) {
    const { name, email, password, phone_number } = userData;

    if (!name || !email || !password || !phone_number) {
      throw new AppError(
        ErrorCodes.VALIDATION_FAILED,
        "All fields are required: name, email, password, phone_number",
        400,
      );
    }

    const requestedRole = String(userData.role || "user").toLowerCase();
    const role = SELF_ASSIGNABLE_ROLES.includes(requestedRole)
      ? requestedRole
      : "user";

    // FIX (from your file): you computed `status` from role but then
    // passed `USER_STATUS.PENDING` verbatim into `prisma.user.create`,
    // so hosts and users ended up identical. Use the computed value.
    const status = role === "host" ? USER_STATUS.PENDING : USER_STATUS.ACTIVE;

    const normalizedEmail = email.trim().toLowerCase();

    const existingUser = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (existingUser) {
      // Enumeration note: acceptable on register (user is telling us
      // an email on purpose). Same behavior as before.
      throw new AppError(
        ErrorCodes.VALIDATION_FAILED,
        "User already exists with this email",
        409,
      );
    }

    const hashedPassword = await this.hashPassword(password);

    const verificationToken = generateToken();
    const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const user = await prisma.user.create({
      data: {
        name: name.trim(),
        email: normalizedEmail,
        password_hash: hashedPassword,
        phone_number: phone_number.trim(),

        role,
        status,

        email_verification_token: verificationToken,
        email_verification_expires: verificationExpires,

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
          notificationSent: { oneWeek: false, twoDays: false },
        },

        user_details: {
          preferences: {},
          bookings: [],
        },
      },
    });

    // ============================================================
    // SEND VERIFICATION EMAIL (retry, non-fatal)
    // ============================================================
    let emailSent = false;
    let emailError = null;

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const emailResult = await emailService.sendVerificationEmail(
          email,
          name,
          verificationToken,
        );
        if (emailResult.success) {
          emailSent = true;
          break;
        }
        emailError = emailResult.error;
      } catch (error) {
        emailError = error.message;
      }
      if (attempt < 3) {
        await new Promise((r) => setTimeout(r, 2000));
      }
    }

    if (!emailSent) {
      // eslint-disable-next-line no-console
      console.error(`❌ All email attempts failed: ${emailError}`);
    }

    // ============================================================
    // SESSION + TOKENS
    // ============================================================
    let session;
    try {
      session = await prisma.userSession.create({
        data: {
          user_id: user.id,
          device: deviceInfo.device || "unknown",
          browser: deviceInfo.browser || "unknown",
          os: deviceInfo.os || "unknown",
          ip_address: deviceInfo.ip || "unknown",
          user_agent: deviceInfo.userAgent || "unknown",
          is_active: true,
          logged_in_at: new Date(),
        },
      });
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("❌ Failed to create session:", error.message);
      throw new AppError(
        ErrorCodes.INTERNAL_ERROR,
        "Failed to create session",
        500,
      );
    }

    const tokens = this.generateTokens(user.id, session.id);

    try {
      await prisma.userSession.update({
        where: { id: session.id },
        data: { refresh_token_hash: this.hashToken(tokens.refreshToken) },
      });
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("❌ Failed to store refresh token hash:", error.message);
    }

    const { password_hash, ...userWithoutPassword } = user;
    return { user: userWithoutPassword, tokens };
  }

  // ============================================================
  // LOGIN USER
  // ============================================================
  async login(email, password, deviceInfo = {}) {
    const normalizedEmail = email.trim().toLowerCase();

    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
      include: {
        id_documents: { orderBy: { created_at: "desc" } },
        // NEW: needed by buildVerificationStatus for the host response.
        host_subscription_payments: { orderBy: { created_at: "desc" } },
      },
    });

    const invalidCredentials = () =>
      new AppError(
        ErrorCodes.INVALID_CREDENTIALS,
        "Invalid email or password",
        401,
      );

    if (!user) throw invalidCredentials();

    const isMatch = await this.comparePassword(password, user.password_hash);
    if (!isMatch) throw invalidCredentials();

    // ============================================================
    // EMAIL VERIFICATION
    // ============================================================
    if (!user.email_verified) {
      const tokenExpired =
        !user.email_verification_token ||
        (user.email_verification_expires &&
          new Date(user.email_verification_expires) < new Date());

      let newToken = user.email_verification_token;
      let newExpiry = user.email_verification_expires;

      if (tokenExpired) {
        newToken = generateToken();
        newExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);

        await prisma.user.update({
          where: { id: user.id },
          data: {
            email_verification_token: newToken,
            email_verification_expires: newExpiry,
          },
        });
      }

      try {
        await emailService.sendVerificationEmail(
          user.email,
          user.name,
          newToken,
        );
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error("❌ Failed to send verification email:", error.message);
      }

      // Do NOT leak the token in the error payload (already fixed in
      // your file; kept).
      throw new AppError(
        ErrorCodes.EMAIL_NOT_VERIFIED,
        "Please verify your email address before logging in",
        403,
        {
          email: user.email,
          userData: {
            id: user.id,
            email: user.email,
            name: user.name,
            tokenExpired,
          },
        },
      );
    }

    // ============================================================
    // HOST LOGIN LOGIC (unchanged behavior)
    // ============================================================
    let loginMessage = "Login successful";
    let requiresIdUpload = false;
    let isHostApproved = true;

    if (user.role === "host") {
      const idDocuments = Array.isArray(user.id_documents)
        ? user.id_documents
        : [];

      const hasIdDocuments = idDocuments.length > 0;
      const hasApprovedId = idDocuments.some((d) => d.status === "approved");
      const hasPendingId = idDocuments.some((d) => d.status === "pending");
      const hasRejectedId = idDocuments.some((d) => d.status === "rejected");

      if (user.status === "pending") {
        if (!hasIdDocuments) {
          requiresIdUpload = true;
          isHostApproved = false;
          loginMessage =
            "Please upload your ID/Passport to complete verification";
        } else if (hasRejectedId && !hasApprovedId) {
          requiresIdUpload = true;
          isHostApproved = false;
          loginMessage =
            "Your ID/Passport was rejected. Please upload a new document.";
        } else if (hasPendingId && !hasApprovedId) {
          isHostApproved = false;
          loginMessage = "Your ID/Passport is pending admin verification.";
        } else {
          isHostApproved = false;
          loginMessage = "Your host account is pending admin approval.";
        }
      } else if (user.status === "suspended") {
        throw new AppError(
          ErrorCodes.FORBIDDEN,
          "Your account has been suspended.",
          403,
        );
      }
    }

    // ============================================================
    // UPDATE LAST ACTIVE / RESET SESSIONS / CREATE SESSION
    // ============================================================
    await prisma.user.update({
      where: { id: user.id },
      data: { last_active: new Date() },
    });

    await prisma.userSession.updateMany({
      where: { user_id: user.id, is_active: true },
      data: { is_active: false, logged_out_at: new Date() },
    });

    let session;
    try {
      session = await prisma.userSession.create({
        data: {
          user_id: user.id,
          device: deviceInfo.device || "desktop",
          browser: deviceInfo.browser || "unknown",
          os: deviceInfo.os || "unknown",
          ip_address: deviceInfo.ip || null,
          user_agent: deviceInfo.userAgent || null,
          is_active: true,
          logged_in_at: new Date(),
        },
      });
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("❌ Failed to create session:", error.message);
      throw new AppError(
        ErrorCodes.INTERNAL_ERROR,
        "Failed to create session",
        500,
      );
    }

    const tokens = this.generateTokens(user.id, session.id);

    try {
      await prisma.userSession.update({
        where: { id: session.id },
        data: { refresh_token_hash: this.hashToken(tokens.refreshToken) },
      });
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("❌ Failed to store refresh token hash:", error.message);
    }

    // ============================================================
    // LOG LOGIN EVENT (non-fatal)
    // ============================================================
    try {
      await prisma.userEvent.create({
        data: {
          user_id: user.id,
          event_type: "login",
          metadata: {
            ip: deviceInfo.ip || null,
            device: deviceInfo.device || "desktop",
            browser: deviceInfo.browser || "unknown",
            os: deviceInfo.os || "unknown",
            userAgent: deviceInfo.userAgent || null,
          },
        },
      });
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("❌ Failed to log event:", error.message);
    }

    // ============================================================
    // CACHE USER (non-fatal)
    // ============================================================
    try {
      await redisHelpers.set(
        `user:${user.id}`,
        {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          status: user.status,
          requiresIdUpload,
          isHostApproved,
        },
        3600,
      );
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("❌ Failed to cache user:", error.message);
    }

    // ============================================================
    // RESPONSE
    //
    // `verificationStatus` is attached here using the SAME formatter
    // as the standalone /host-verification-status endpoint, so both
    // endpoints stay in sync forever.
    // ============================================================
    const { password_hash, ...userWithoutPassword } = user;

    const enriched = {
      ...userWithoutPassword,
      requiresIdUpload,
      isHostApproved,
      loginMessage,
    };

    if (user.role === "host") {
      enriched.verificationStatus = buildVerificationStatus(user);
    }

    return { user: enriched, tokens };
  }

  // ============================================================
  // LOGOUT
  // ============================================================
  async logout(userId, sessionId = null) {
    if (sessionId) {
      await prisma.userSession.update({
        where: { id: sessionId },
        data: {
          is_active: false,
          logged_out_at: new Date(),
          refresh_token_hash: null,
        },
      });
    } else {
      await prisma.userSession.updateMany({
        where: { user_id: userId, is_active: true },
        data: {
          is_active: false,
          logged_out_at: new Date(),
          refresh_token_hash: null,
        },
      });
    }

    await redisHelpers.del(`user:${userId}`);
  }

  // ============================================================
  // REFRESH TOKEN
  // ============================================================
  async refreshToken(refreshToken) {
    const decoded = this.verifyToken(refreshToken, "refresh");
    if (!decoded) {
      throw new AppError(
        ErrorCodes.TOKEN_INVALID,
        "Invalid refresh token",
        401,
      );
    }

    const session = await prisma.userSession.findUnique({
      where: { id: decoded.sessionId },
    });

    if (!session || !session.is_active || session.user_id !== decoded.id) {
      throw new AppError(
        ErrorCodes.TOKEN_INVALID,
        "Session has been revoked",
        401,
      );
    }

    if (session.refresh_token_hash !== this.hashToken(refreshToken)) {
      await prisma.userSession.update({
        where: { id: session.id },
        data: { is_active: false, logged_out_at: new Date() },
      });
      throw new AppError(
        ErrorCodes.TOKEN_INVALID,
        "Refresh token reuse detected — session revoked",
        401,
      );
    }

    const user = await prisma.user.findUnique({ where: { id: decoded.id } });
    if (!user) {
      throw new AppError(ErrorCodes.USER_NOT_FOUND, "User not found", 404);
    }

    if (user.status === "suspended" || user.status === "banned") {
      throw new AppError(
        ErrorCodes.FORBIDDEN,
        `Account is ${user.status}`,
        403,
      );
    }

    const newTokens = this.generateTokens(user.id, session.id);
    await prisma.userSession.update({
      where: { id: session.id },
      data: { refresh_token_hash: this.hashToken(newTokens.refreshToken) },
    });

    return newTokens;
  }

  // ============================================================
  // VERIFY EMAIL
  // ============================================================
  async verifyEmail(token) {
    if (!token) {
      return { error: "invalid-token", message: "No verification token provided" };
    }

    const user = await prisma.user.findFirst({
      where: { email_verification_token: token },
    });

    if (!user) {
      return { error: "invalid-token", message: "Invalid verification token" };
    }

    if (
      user.email_verification_expires &&
      new Date(user.email_verification_expires) < new Date()
    ) {
      return {
        error: "token-expired",
        message: "Verification token has expired",
        email: user.email,
        needsNewToken: true,
      };
    }

    if (user.email_verified) {
      return {
        error: "already-verified",
        message: "Email is already verified",
        email: user.email,
      };
    }

    let newStatus = user.status;
    if (user.role === "user") {
      newStatus = USER_STATUS.ACTIVE;
    }

    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: {
        email_verified: true,
        email_verification_token: null,
        email_verification_expires: null,
        status: newStatus,
      },
    });

    await redisHelpers.del(`user:${user.id}`);

    try {
      await prisma.userEvent.create({
        data: {
          user_id: user.id,
          event_type: "email_verified",
          metadata: { timestamp: new Date().toISOString(), token_used: true },
        },
      });
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("❌ Failed to log email verification:", error.message);
    }

    const { password_hash, ...userWithoutPassword } = updatedUser;

    return {
      success: true,
      user: userWithoutPassword,
      message: "Email verified successfully",
      redirectTo: "/login",
    };
  }

  // ============================================================
  // REQUEST PASSWORD RESET
  // ============================================================
  async requestPasswordReset(email) {
    const normalizedEmail = email.trim().toLowerCase();
    const genericResponse = {
      message:
        "If an account with that email exists, a password reset link has been sent.",
    };

    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (!user) return genericResponse;

    const resetToken = generateToken();
    const resetExpires = new Date(Date.now() + 60 * 60 * 1000);

    await prisma.user.update({
      where: { id: user.id },
      data: {
        reset_password_token: resetToken,
        reset_password_expires: resetExpires,
      },
    });

    try {
      await emailService.sendPasswordResetEmail(
        normalizedEmail,
        user.name,
        resetToken,
      );
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("Failed to send password reset email:", error);
    }

    return genericResponse;
  }

  // ============================================================
  // RESET PASSWORD
  // ============================================================
  async resetPassword(token, newPassword) {
    const user = await prisma.user.findFirst({
      where: {
        reset_password_token: token,
        reset_password_expires: { gt: new Date() },
      },
    });

    if (!user) {
      throw new AppError(
        ErrorCodes.TOKEN_INVALID,
        "Invalid or expired reset token",
        400,
      );
    }

    const hashedPassword = await this.hashPassword(newPassword);

    await prisma.user.update({
      where: { id: user.id },
      data: {
        password_hash: hashedPassword,
        reset_password_token: null,
        reset_password_expires: null,
      },
    });

    await prisma.userSession.updateMany({
      where: { user_id: user.id, is_active: true },
      data: {
        is_active: false,
        logged_out_at: new Date(),
        refresh_token_hash: null,
      },
    });

    return { message: "Password reset successfully" };
  }

  // ============================================================
  // GET USER BY ID
  // ============================================================
  async getUserById(userId) {
    const cachedUser = await redisHelpers.get(`user:${userId}`);
    if (cachedUser) return cachedUser;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        listings: {
          where: { is_active: true },
          take: 5,
          orderBy: { created_at: "desc" },
        },
        bookings: { take: 5, orderBy: { created_at: "desc" } },
        id_documents: { orderBy: { created_at: "desc" } },
      },
    });

    if (!user) {
      throw new AppError(ErrorCodes.USER_NOT_FOUND, "User not found", 404);
    }

    const { password_hash, ...userWithoutPassword } = user;
    await redisHelpers.set(`user:${userId}`, userWithoutPassword, 3600);

    return userWithoutPassword;
  }

  // ============================================================
  // UPDATE USER
  //
  // Service-side whitelist as defense-in-depth. If someone later adds
  // a new route that calls updateUser(req.user.id, req.body), this
  // still refuses to accept role/status/email/password_hash.
  // ============================================================
  async updateUser(userId, updateData) {
    const safeData = {};
    for (const key of SELF_EDITABLE_USER_FIELDS) {
      if (updateData[key] !== undefined) safeData[key] = updateData[key];
    }

    if (Object.keys(safeData).length === 0) {
      throw new AppError(
        ErrorCodes.VALIDATION_FAILED,
        "No updatable fields provided",
        400,
      );
    }

    const user = await prisma.user.update({
      where: { id: userId },
      data: safeData,
    });

    await redisHelpers.del(`user:${userId}`);

    const { password_hash, ...userWithoutPassword } = user;
    return userWithoutPassword;
  }

  // ============================================================
  // CHANGE PASSWORD
  // ============================================================
  async changePassword(userId, currentPassword, newPassword) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { password_hash: true },
    });

    if (!user) {
      throw new AppError(ErrorCodes.USER_NOT_FOUND, "User not found", 404);
    }

    const isMatch = await this.comparePassword(
      currentPassword,
      user.password_hash,
    );

    if (!isMatch) {
      throw new AppError(
        ErrorCodes.VALIDATION_FAILED,
        "Current password is incorrect",
        400,
      );
    }

    const hashedPassword = await this.hashPassword(newPassword);

    await prisma.user.update({
      where: { id: userId },
      data: { password_hash: hashedPassword },
    });

    await prisma.userSession.updateMany({
      where: { user_id: userId, is_active: true },
      data: {
        is_active: false,
        logged_out_at: new Date(),
        refresh_token_hash: null,
      },
    });

    await redisHelpers.del(`user:${userId}`);

    return { message: "Password changed successfully" };
  }

  // ============================================================
  // RESEND EMAIL VERIFICATION
  // ============================================================
  async resendVerificationEmail(email) {
    const normalizedEmail = email.trim().toLowerCase();
    const genericResponse = {
      message:
        "If an account with that email exists and needs verification, an email has been sent.",
    };

    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (!user || user.email_verified) return genericResponse;

    const hasValidToken =
      user.email_verification_token &&
      user.email_verification_expires &&
      new Date(user.email_verification_expires) > new Date();

    let tokenToSend = user.email_verification_token;

    if (!hasValidToken) {
      tokenToSend = generateToken();
      const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);

      await prisma.user.update({
        where: { id: user.id },
        data: {
          email_verification_token: tokenToSend,
          email_verification_expires: verificationExpires,
        },
      });
    }

    try {
      await emailService.sendVerificationEmail(
        user.email,
        user.name,
        tokenToSend,
      );
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("Failed to send verification email:", error.message);
    }

    return genericResponse;
  }

  // ============================================================
  // CHECK VERIFICATION STATUS
  // ============================================================
  async checkVerificationStatus(email) {
    const normalizedEmail = email.trim().toLowerCase();

    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: {
        email_verified: true,
        email_verification_expires: true,
      },
    });

    if (!user) {
      return {
        email_verified: false,
        needs_verification: true,
        token_expired: true,
      };
    }

    const isTokenExpired =
      user.email_verification_expires &&
      new Date(user.email_verification_expires) < new Date();

    return {
      email_verified: user.email_verified,
      needs_verification: !user.email_verified,
      token_expired: !!isTokenExpired,
    };
  }

  // ============================================================
  // GENERATE NEW VERIFICATION TOKEN
  // ============================================================
  async generateNewVerificationToken(userId) {
    const user = await prisma.user.findUnique({ where: { id: userId } });

    if (!user) {
      throw new AppError(ErrorCodes.USER_NOT_FOUND, "User not found", 404);
    }

    if (user.email_verified) {
      throw new AppError(
        ErrorCodes.EMAIL_ALREADY_VERIFIED,
        "Email is already verified",
        400,
      );
    }

    const verificationToken = generateToken();
    const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await prisma.user.update({
      where: { id: userId },
      data: {
        email_verification_token: verificationToken,
        email_verification_expires: verificationExpires,
      },
    });

    const emailResult = await emailService.sendVerificationEmail(
      user.email,
      user.name,
      verificationToken,
    );

    if (!emailResult.success) {
      throw new AppError(
        ErrorCodes.INTERNAL_ERROR,
        emailResult.error || "Failed to send verification email",
        500,
      );
    }

    return {
      message: "New verification token generated and email sent",
      tokenExpiry: verificationExpires,
    };
  }

  // ============================================================
  // ADD ID IMAGE (NEW — replaces the controller's inline Prisma call)
  //
  // Stores a URL into `User.id_images` array (kept for the legacy
  // frontend flow). Newer code should create UserIdDocument rows
  // instead — see createHostProfile comment for rationale.
  // ============================================================
  async addIdImage(userId, url) {
    if (!url || typeof url !== "string") {
      throw new AppError(
        ErrorCodes.VALIDATION_FAILED,
        "Image URL is required",
        400,
      );
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true },
    });

    if (!user) {
      throw new AppError(ErrorCodes.USER_NOT_FOUND, "User not found", 404);
    }

    // Only hosts upload ID documents. (Adjust if you want users to
    // pre-upload before becoming hosts.)
    if (user.role !== "host") {
      throw new AppError(
        ErrorCodes.FORBIDDEN,
        "Only hosts can upload ID documents",
        403,
      );
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: {
        id_images: { push: url },
      },
      select: {
        id: true,
        name: true,
        email: true,
        phone_number: true,
        id_images: true,
      },
    });

    await redisHelpers.del(`user:${userId}`);
    return updated;
  }

  // ============================================================
  // CREATE HOST PROFILE
  // ============================================================
  async createHostProfile(userId, hostData) {
    const user = await prisma.user.findUnique({ where: { id: userId } });

    if (!user) {
      throw new AppError(ErrorCodes.USER_NOT_FOUND, "User not found", 404);
    }

    if (user.role === "host") {
      throw new AppError(
        ErrorCodes.VALIDATION_FAILED,
        "User is already a host",
        400,
      );
    }

    // Strip client-supplied verification fields — same fix as your
    // original file, kept intact.
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
      ...safeHostData
    } = hostData || {};

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        role: "host",
        status: USER_STATUS.PENDING,
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
          notificationSent: { oneWeek: false, twoDays: false },
          ...safeHostData,
        },
      },
    });

    try {
      await emailService.sendHostVerificationEmail(user.email, user.name);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("Failed to send host verification email:", error);
    }

    const { password_hash, ...userWithoutPassword } = updatedUser;
    return userWithoutPassword;
  }
}

module.exports = new AuthService();