//backend/src/service/authService
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { prisma } = require("../config/database");
const { redisHelpers } = require("../config/redis");
const emailService = require("./emailService");
const { generateToken, generateOTP } = require("../utils/helpers");
const { USER_STATUS } = require("../utils/constants");

// SECURITY: fail fast instead of silently falling back to JWT_SECRET.
// Sharing one secret between access and refresh tokens means a leaked
// refresh token can be replayed as an access token and vice versa.
if (!process.env.JWT_SECRET || !process.env.JWT_REFRESH_SECRET) {
  throw new Error(
    "JWT_SECRET and JWT_REFRESH_SECRET must both be set (and must be different values)."
  );
}

// Roles a client is ever allowed to request for themselves.
// "admin" and "super_admin" are deliberately excluded — those are only
// ever granted by an already-authenticated admin via a separate endpoint.
const SELF_ASSIGNABLE_ROLES = ["user", "host"];

const ACCESS_TOKEN_EXPIRES_IN = process.env.JWT_EXPIRE || "15m";
const REFRESH_TOKEN_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRE || "7d";

class AuthService {
  // ============================================================
  // HASH PASSWORD
  // ============================================================
  async hashPassword(password) {
    // SECURITY: bumped from 10 -> 12 rounds for more headroom against
    // offline cracking if the DB is ever exfiltrated.
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
  //
  // SECURITY: tokens now carry a `type` claim so an access token can
  // never be used where a refresh token is expected, or vice versa.
  // They also carry the active session's id, so `protect` (in the
  // middleware) can confirm the session hasn't been revoked
  // (logout / password change / admin suspension) even though the
  // JWT signature itself is still valid.
  //
  // NOTE: this assumes a `UserSession.id` column already exists
  // (it does, per your schema) and that we pass it in at call sites.
  // ============================================================
  generateTokens(userId, sessionId) {
    const accessToken = jwt.sign(
      { id: userId, sessionId, type: "access" },
      process.env.JWT_SECRET,
      { expiresIn: ACCESS_TOKEN_EXPIRES_IN }
    );

    const refreshToken = jwt.sign(
      { id: userId, sessionId, type: "refresh" },
      process.env.JWT_REFRESH_SECRET,
      { expiresIn: REFRESH_TOKEN_EXPIRES_IN }
    );

    return { accessToken, refreshToken };
  }

  // ============================================================
  // VERIFY TOKEN
  //
  // SECURITY: expectedType is now required and enforced. Pass
  // "access" for normal auth, "refresh" for the refresh endpoint.
  // ============================================================
  verifyToken(token, expectedType = "access") {
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
    } catch (error) {
      return null;
    }
  }

  // ============================================================
  // HASH A REFRESH TOKEN FOR STORAGE
  //
  // SECURITY: we never store raw refresh tokens. We store a hash so
  // that a DB read (backup leak, SQL console, etc.) can't be used to
  // impersonate a user.
  // ============================================================
  hashToken(token) {
    return crypto.createHash("sha256").update(token).digest("hex");
  }

  // ============================================================
  // REGISTER USER
  // ============================================================
  async register(userData) {
    console.log("📝 Registering user:", {
      email: userData.email,
      name: userData.name,
    });

    const { name, email, password, phone_number } = userData;

    // SECURITY: role is deliberately NOT destructured from client input.
    // Previously `role = userData.role || "user"` let anyone self-assign
    // "admin" by sending { "role": "admin" } on signup. Every new
    // registration is forced to "user"; becoming a host happens only
    // through createHostProfile() below, and becoming an admin only
    // through an authenticated admin-only endpoint you control separately.
    const role = "user";

    if (
      userData.role &&
      !SELF_ASSIGNABLE_ROLES.includes(userData.role)
    ) {
      console.warn(
        `⚠️ Registration attempted to set disallowed role "${userData.role}" — ignored.`
      );
    }

    // ----------------------------------------------------------
    // Validate required fields
    // ----------------------------------------------------------
    if (!name || !email || !password || !phone_number) {
      throw new Error(
        "All fields are required: name, email, password, phone_number"
      );
    }

    // ----------------------------------------------------------
    // Normalize email
    // ----------------------------------------------------------
    const normalizedEmail = email.trim().toLowerCase();

    // ----------------------------------------------------------
    // Check if user already exists
    // ----------------------------------------------------------
    const existingUser = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (existingUser) {
      // SECURITY: this message is fine pre-auth for register (the user
      // is telling us an email on purpose), unlike login/reset, so we
      // leave it as-is. If you want zero enumeration surface anywhere,
      // you can switch this to "If that email can be used, we've sent
      // next steps to it" and email the existing user a "did you mean
      // to log in?" notice instead of throwing.
      throw new Error("User already exists with this email");
    }

    // ----------------------------------------------------------
    // Hash password
    // ----------------------------------------------------------
    const hashedPassword = await this.hashPassword(password);

    // ----------------------------------------------------------
    // Generate email verification token
    // ----------------------------------------------------------
    const verificationToken = generateToken();
    const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);

    console.log("✅ Creating user in database...");

    // ----------------------------------------------------------
    // CREATE USER
    //
    // IMPORTANT: Do NOT use id_images here. IDs are stored in
    // UserIdDocument.
    // ----------------------------------------------------------
    const user = await prisma.user.create({
      data: {
        name: name.trim(),
        email: normalizedEmail,
        password_hash: hashedPassword,
        phone_number: phone_number.trim(),

        role,
        status: USER_STATUS.PENDING,

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

    console.log("✅ User created successfully:", user.id);

    // ============================================================
    // SEND VERIFICATION EMAIL
    // ============================================================
    let emailSent = false;
    let emailError = null;

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const emailResult = await emailService.sendVerificationEmail(
          email,
          name,
          verificationToken
        );

        if (emailResult.success) {
          emailSent = true;
          break;
        } else {
          emailError = emailResult.error;
        }
      } catch (error) {
        emailError = error.message;
      }

      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }

    if (!emailSent) {
      console.error(`❌ All email attempts failed: ${emailError}`);
      // Do not fail registration because email failed.
      // User can resend verification later.
    }

    // ============================================================
    // CREATE SESSION, THEN GENERATE TOKENS BOUND TO IT
    //
    // SECURITY: session is created first so we have a sessionId to
    // embed in the JWTs. We also store a hash of the refresh token on
    // the session row so refreshToken() can detect reuse/rotation
    // later.
    // ============================================================
    let session;
    try {
      session = await prisma.userSession.create({
        data: {
          user_id: user.id,
          is_active: true,
          logged_in_at: new Date(),
        },
      });
    } catch (error) {
      console.error("❌ Failed to create session:", error.message);
      throw new Error("Failed to create session");
    }

    const tokens = this.generateTokens(user.id, session.id);

    try {
      await prisma.userSession.update({
        where: { id: session.id },
        data: { refresh_token_hash: this.hashToken(tokens.refreshToken) },
      });
    } catch (error) {
      console.error(
        "❌ Failed to store refresh token hash:",
        error.message
      );
    }

    // ============================================================
    // REMOVE PASSWORD
    // ============================================================
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
      },
    });

    // SECURITY: generic message regardless of whether the email exists,
    // to prevent account enumeration. Previously "User not found" vs
    // "Invalid credentials" told an attacker which emails are registered.
    const invalidCredentialsError = () => new Error("Invalid email or password");

    if (!user) {
      throw invalidCredentialsError();
    }

    const isMatch = await this.comparePassword(password, user.password_hash);

    if (!isMatch) {
      throw invalidCredentialsError();
    }

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
          newToken
        );
      } catch (error) {
        console.error(
          "❌ Failed to send verification email:",
          error.message
        );
      }

      const error = new Error(
        "Please verify your email address before logging in"
      );
      error.code = "EMAIL_NOT_VERIFIED";

      // SECURITY: do not leak the raw verification token in the error
      // payload. It was previously returned as error.userData.token,
      // which meant any client that could trigger a failed login (no
      // auth needed) could pull out a live token usable to verify —
      // and in some flows take over — the account.
      error.userData = {
        id: user.id,
        email: user.email,
        name: user.name,
        tokenExpired,
      };

      throw error;
    }

    // ============================================================
    // HOST LOGIN LOGIC
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
        throw new Error("Your account has been suspended.");
      }
    }

    // ============================================================
    // UPDATE LAST ACTIVE
    // ============================================================
    await prisma.user.update({
      where: { id: user.id },
      data: { last_active: new Date() },
    });

    // ============================================================
    // RESET OLD SESSIONS
    //
    // NOTE: if you want to support multiple concurrent devices,
    // remove this and instead just create an additional session row
    // per login rather than deactivating existing ones.
    // ============================================================
    await prisma.userSession.updateMany({
      where: { user_id: user.id, is_active: true },
      data: { is_active: false, logged_out_at: new Date() },
    });

    // ============================================================
    // CREATE SESSION, THEN GENERATE TOKENS BOUND TO IT
    // ============================================================
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
      console.error("❌ Failed to create session:", error.message);
      throw new Error("Failed to create session");
    }

    const tokens = this.generateTokens(user.id, session.id);

    try {
      await prisma.userSession.update({
        where: { id: session.id },
        data: { refresh_token_hash: this.hashToken(tokens.refreshToken) },
      });
    } catch (error) {
      console.error(
        "❌ Failed to store refresh token hash:",
        error.message
      );
    }

    // ============================================================
    // LOG LOGIN EVENT
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
      console.error("❌ Failed to log event:", error.message);
    }

    // ============================================================
    // CACHE USER
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
        3600
      );
    } catch (error) {
      console.error("❌ Failed to cache user:", error.message);
    }

    // ============================================================
    // RESPONSE
    // ============================================================
    const { password_hash, id_documents, ...userWithoutPassword } = user;

    return {
      user: {
        ...userWithoutPassword,
        requiresIdUpload,
        isHostApproved,
        loginMessage,
      },
      tokens,
    };
  }

  // ============================================================
  // LOGOUT USER
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
  //
  // SECURITY: this now
  //   1. verifies the token was actually issued as a refresh token
  //      (expectedType="refresh"),
  //   2. confirms the session it's bound to is still active
  //      (so logout / suspension actually revokes it), and
  //   3. rotates the refresh token: the old one's hash is replaced,
  //      so a captured-then-reused old refresh token fails, which
  //      gives you basic reuse detection (a failed lookup here is a
  //      signal you may want to alert on / kill the whole session).
  // ============================================================
  async refreshToken(refreshToken) {
    const decoded = this.verifyToken(refreshToken, "refresh");

    if (!decoded) {
      throw new Error("Invalid refresh token");
    }

    const session = await prisma.userSession.findUnique({
      where: { id: decoded.sessionId },
    });

    if (!session || !session.is_active || session.user_id !== decoded.id) {
      throw new Error("Session has been revoked");
    }

    if (session.refresh_token_hash !== this.hashToken(refreshToken)) {
      // Token doesn't match what we last issued for this session —
      // either it's stale (already rotated) or was never ours.
      // Kill the session defensively.
      await prisma.userSession.update({
        where: { id: session.id },
        data: { is_active: false, logged_out_at: new Date() },
      });
      throw new Error("Refresh token reuse detected — session revoked");
    }

    const user = await prisma.user.findUnique({ where: { id: decoded.id } });

    if (!user) {
      throw new Error("User not found");
    }

    if (user.status === "suspended" || user.status === "banned") {
      throw new Error(`Account is ${user.status}`);
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
  //
  // SECURITY: no longer throws when the email doesn't exist — that
  // let an attacker enumerate registered emails. Always returns the
  // same generic response; only actually emails a token if the user
  // exists.
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

    if (!user) {
      return genericResponse;
    }

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
        resetToken
      );
    } catch (error) {
      console.error("Failed to send password reset email:", error);
      // Still return the generic response — don't reveal whether the
      // email send failed, and don't let email-provider errors leak
      // account existence either.
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
      throw new Error("Invalid or expired reset token");
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

    // SECURITY: also clear refresh token hashes, not just is_active,
    // so any refresh token issued before the password change is
    // useless even if refreshToken()'s active-session check were
    // ever bypassed.
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
    if (cachedUser) {
      return cachedUser;
    }

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
      throw new Error("User not found");
    }

    const { password_hash, ...userWithoutPassword } = user;

    await redisHelpers.set(`user:${userId}`, userWithoutPassword, 3600);

    return userWithoutPassword;
  }

  // ============================================================
  // UPDATE USER
  // ============================================================
  async updateUser(userId, updateData) {
    // SECURITY: also strip status — a user should never be able to
    // un-suspend or self-approve their own account via a generic
    // "update profile" endpoint. Status changes belong in an
    // admin-only path.
    const { password_hash, email, role, status, ...safeData } = updateData;

    const user = await prisma.user.update({
      where: { id: userId },
      data: safeData,
    });

    await redisHelpers.del(`user:${userId}`);

    const { password_hash: _, ...userWithoutPassword } = user;

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
      throw new Error("User not found");
    }

    const isMatch = await this.comparePassword(
      currentPassword,
      user.password_hash
    );

    if (!isMatch) {
      throw new Error("Current password is incorrect");
    }

    const hashedPassword = await this.hashPassword(newPassword);

    await prisma.user.update({
      where: { id: userId },
      data: { password_hash: hashedPassword },
    });

    // SECURITY: clear refresh_token_hash too (see resetPassword note above).
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
  //
  // SECURITY: no longer throws "User not found" (enumeration). Also
  // no longer throws "Email is already verified" for the same reason
  // — both now return the same generic message.
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

    if (!user || user.email_verified) {
      return genericResponse;
    }

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
      await emailService.sendVerificationEmail(user.email, user.name, tokenToSend);
    } catch (error) {
      console.error("Failed to send verification email:", error.message);
      // Still return the generic response.
    }

    return genericResponse;
  }

  // ============================================================
  // CHECK VERIFICATION STATUS
  //
  // SECURITY: this used to return the raw email_verification_token
  // to anyone who called it with a known email — no auth required.
  // That token can complete email verification (and for hosts,
  // materially changes account state), so leaking it was equivalent
  // to leaking a takeover credential. It's removed from the response
  // entirely; only status booleans are returned.
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
      // Generic shape so this can't be used to enumerate emails either.
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
      throw new Error("User not found");
    }

    if (user.email_verified) {
      throw new Error("Email is already verified");
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
      verificationToken
    );

    if (!emailResult.success) {
      throw new Error(
        emailResult.error || "Failed to send verification email"
      );
    }

    return {
      message: "New verification token generated and email sent",
      tokenExpiry: verificationExpires,
    };
  }

  // ============================================================
  // CREATE HOST PROFILE
  // ============================================================
  async createHostProfile(userId, hostData) {
    const user = await prisma.user.findUnique({ where: { id: userId } });

    if (!user) {
      throw new Error("User not found");
    }

    if (user.role === "host") {
      throw new Error("User is already a host");
    }

    // Old frontend may still send idImages. We deliberately remove it
    // so it can never be written into the User Prisma model. Actual ID
    // documents belong in UserIdDocument.
    //
    // SECURITY: also strip verified/id_verified/payment_verified etc.
    // from client-supplied hostData — previously `...safeHostData` was
    // spread in AFTER the safe defaults, so a client sending
    // { "verified": true, "id_verified": true } in the request body
    // would override the defaults and self-approve verification.
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
      console.error("Failed to send host verification email:", error);
    }

    const { password_hash, ...userWithoutPassword } = updatedUser;

    return userWithoutPassword;
  }
}

module.exports = new AuthService();