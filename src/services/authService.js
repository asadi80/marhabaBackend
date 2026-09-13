const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { prisma } = require("../config/database");
const { redisHelpers } = require("../config/redis");
const emailService = require("./emailService");
const { generateToken, generateOTP } = require("../utils/helpers");
const { USER_STATUS } = require("../utils/constants");

class AuthService {
  // ============================================================
  // HASH PASSWORD
  // ============================================================
  async hashPassword(password) {
    const salt = await bcrypt.genSalt(10);
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
  generateTokens(userId) {
    const accessToken = jwt.sign(
      { id: userId },
      process.env.JWT_SECRET,
      {
        expiresIn: process.env.JWT_EXPIRE || "30d",
      }
    );

    const refreshToken = jwt.sign(
      { id: userId },
      process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET,
      {
        expiresIn: process.env.JWT_REFRESH_EXPIRE || "7d",
      }
    );

    return {
      accessToken,
      refreshToken,
    };
  }

  // ============================================================
  // VERIFY TOKEN
  // ============================================================
  verifyToken(token, isRefresh = false) {
    const secret = isRefresh
      ? process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET
      : process.env.JWT_SECRET;

    try {
      return jwt.verify(token, secret);
    } catch (error) {
      return null;
    }
  }

  // ============================================================
  // REGISTER USER
  // ============================================================
  async register(userData) {
    console.log("📝 Registering user:", {
      email: userData.email,
      name: userData.name,
      role: userData.role || "user",
    });

    const {
      name,
      email,
      password,
      phone_number,
      role = "user",
    } = userData;

    // ----------------------------------------------------------
    // Validate required fields
    // ----------------------------------------------------------
    if (!name || !email || !password || !phone_number) {
      console.error("❌ Missing required fields:", {
        name,
        email,
        password: !!password,
        phone_number,
      });

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
      where: {
        email: normalizedEmail,
      },
    });

    if (existingUser) {
      console.log("⚠️ User already exists:", normalizedEmail);
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

    const verificationExpires = new Date(
      Date.now() + 24 * 60 * 60 * 1000
    );

    console.log("✅ Creating user in database...");

    // ----------------------------------------------------------
    // CREATE USER
    //
    // IMPORTANT:
    // Do NOT use id_images here.
    // IDs are stored in UserIdDocument.
    // ----------------------------------------------------------
    const user = await prisma.user.create({
      data: {
        name: name.trim(),
        email: normalizedEmail,
        password_hash: hashedPassword,
        phone_number: phone_number.trim(),

        role: role,

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
    });

    console.log("✅ User created successfully:", user.id);

    // ============================================================
    // SEND VERIFICATION EMAIL
    // ============================================================
    let emailSent = false;
    let emailError = null;

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        console.log(
          `📧 Sending verification email (attempt ${attempt}/3)...`
        );

        const emailResult =
          await emailService.sendVerificationEmail(
            email,
            name,
            verificationToken
          );

        if (emailResult.success) {
          console.log(
            `✅ Verification email sent: ${emailResult.messageId}`
          );

          emailSent = true;
          break;
        } else {
          emailError = emailResult.error;

          console.error(
            `❌ Attempt ${attempt} failed:`,
            emailResult.error
          );
        }
      } catch (error) {
        emailError = error.message;

        console.error(
          `❌ Attempt ${attempt} failed:`,
          error.message
        );
      }

      if (attempt < 3) {
        console.log("⏳ Waiting 2 seconds before retry...");

        await new Promise((resolve) =>
          setTimeout(resolve, 2000)
        );
      }
    }

    if (!emailSent) {
      console.error(
        `❌ All email attempts failed: ${emailError}`
      );

      // Do not fail registration because email failed.
      // User can resend verification later.
    }

    // ============================================================
    // GENERATE TOKENS
    // ============================================================
    const tokens = this.generateTokens(user.id);

    // ============================================================
    // CREATE SESSION
    // ============================================================
    try {
      await prisma.userSession.create({
        data: {
          user_id: user.id,
          is_active: true,
          logged_in_at: new Date(),
        },
      });

      console.log("✅ Session created");
    } catch (error) {
      console.error(
        "❌ Failed to create session:",
        error.message
      );
    }

    // ============================================================
    // REMOVE PASSWORD
    // ============================================================
    const {
      password_hash,
      ...userWithoutPassword
    } = user;

    return {
      user: userWithoutPassword,
      tokens,
    };
  }

  // ============================================================
  // LOGIN USER
  // ============================================================
  async login(email, password, deviceInfo = {}) {
    console.log("🔐 Login attempt:", {
      email,
    });

    // ----------------------------------------------------------
    // Normalize email
    // ----------------------------------------------------------
    const normalizedEmail = email.trim().toLowerCase();

    // ----------------------------------------------------------
    // Find user
    //
    // IMPORTANT:
    // Load id_documents instead of id_images.
    // ----------------------------------------------------------
    const user = await prisma.user.findUnique({
      where: {
        email: normalizedEmail,
      },

      include: {
        id_documents: {
          orderBy: {
            created_at: "desc",
          },
        },
      },
    });

    if (!user) {
      console.log(
        "❌ User not found:",
        normalizedEmail
      );

      throw new Error("User not found");
    }

    // ============================================================
    // PASSWORD CHECK
    // ============================================================
    const isMatch = await this.comparePassword(
      password,
      user.password_hash
    );

    if (!isMatch) {
      console.log(
        "❌ Invalid password:",
        normalizedEmail
      );

      throw new Error("Invalid credentials");
    }

    // ============================================================
    // EMAIL VERIFICATION
    // ============================================================
    if (!user.email_verified) {
      console.log(
        "❌ Email not verified:",
        normalizedEmail
      );

      const tokenExpired =
        !user.email_verification_token ||
        (
          user.email_verification_expires &&
          new Date(
            user.email_verification_expires
          ) < new Date()
        );

      let newToken =
        user.email_verification_token;

      let newExpiry =
        user.email_verification_expires;

      // ----------------------------------------------------------
      // Generate new verification token
      // ----------------------------------------------------------
      if (tokenExpired) {
        newToken = generateToken();

        newExpiry = new Date(
          Date.now() + 24 * 60 * 60 * 1000
        );

        await prisma.user.update({
          where: {
            id: user.id,
          },

          data: {
            email_verification_token: newToken,
            email_verification_expires: newExpiry,
          },
        });

        console.log(
          "🔄 Generated new verification token for:",
          normalizedEmail
        );
      }

      // ----------------------------------------------------------
      // Send verification email
      // ----------------------------------------------------------
      try {
        await emailService.sendVerificationEmail(
          user.email,
          user.name,
          newToken
        );

        console.log(
          "✅ Verification email sent to:",
          normalizedEmail
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

      error.userData = {
        id: user.id,
        email: user.email,
        name: user.name,
        token: newToken,
        tokenExpired,
        tokenExpiry: newExpiry,
      };

      throw error;
    }

    console.log(
      "✅ Login successful:",
      normalizedEmail
    );

    // ============================================================
    // HOST LOGIN LOGIC
    // ============================================================
    let loginMessage = "Login successful";

    let requiresIdUpload = false;

    let isHostApproved = true;

    if (user.role === "host") {
      // ----------------------------------------------------------
      // UserIdDocument records
      // ----------------------------------------------------------
      const idDocuments = Array.isArray(
        user.id_documents
      )
        ? user.id_documents
        : [];

      const hasIdDocuments =
        idDocuments.length > 0;

      const hasApprovedId =
        idDocuments.some(
          (document) =>
            document.status === "approved"
        );

      const hasPendingId =
        idDocuments.some(
          (document) =>
            document.status === "pending"
        );

      const hasRejectedId =
        idDocuments.some(
          (document) =>
            document.status === "rejected"
        );

      // ----------------------------------------------------------
      // Pending host
      // ----------------------------------------------------------
      if (user.status === "pending") {
        // No ID uploaded
        if (!hasIdDocuments) {
          requiresIdUpload = true;

          isHostApproved = false;

          loginMessage =
            "Please upload your ID/Passport to complete verification";
        }

        // ID rejected
        else if (
          hasRejectedId &&
          !hasApprovedId
        ) {
          requiresIdUpload = true;

          isHostApproved = false;

          loginMessage =
            "Your ID/Passport was rejected. Please upload a new document.";
        }

        // ID pending admin verification
        else if (
          hasPendingId &&
          !hasApprovedId
        ) {
          isHostApproved = false;

          loginMessage =
            "Your ID/Passport is pending admin verification.";
        }

        // ID approved, but host still awaiting admin approval
        else {
          isHostApproved = false;

          loginMessage =
            "Your host account is pending admin approval.";
        }
      }

      // ----------------------------------------------------------
      // Suspended host
      // ----------------------------------------------------------
      else if (user.status === "suspended") {
        console.log(
          "❌ Account suspended:",
          normalizedEmail
        );

        throw new Error(
          "Your account has been suspended."
        );
      }
    }

    // ============================================================
    // UPDATE LAST ACTIVE
    // ============================================================
    await prisma.user.update({
      where: {
        id: user.id,
      },

      data: {
        last_active: new Date(),
      },
    });

    // ============================================================
    // RESET OLD SESSIONS
    // ============================================================
    await prisma.userSession.updateMany({
      where: {
        user_id: user.id,
        is_active: true,
      },

      data: {
        is_active: false,
        logged_out_at: new Date(),
      },
    });

    // ============================================================
    // GENERATE TOKENS
    // ============================================================
    const tokens = this.generateTokens(
      user.id
    );

    // ============================================================
    // CREATE SESSION
    // ============================================================
    try {
      await prisma.userSession.create({
        data: {
          user_id: user.id,

          device:
            deviceInfo.device ||
            "desktop",

          browser:
            deviceInfo.browser ||
            "unknown",

          os:
            deviceInfo.os ||
            "unknown",

          ip_address:
            deviceInfo.ip ||
            null,

          user_agent:
            deviceInfo.userAgent ||
            null,

          is_active: true,

          logged_in_at: new Date(),
        },
      });
    } catch (error) {
      console.error(
        "❌ Failed to create session:",
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
            ip:
              deviceInfo.ip ||
              null,

            device:
              deviceInfo.device ||
              "desktop",

            browser:
              deviceInfo.browser ||
              "unknown",

            os:
              deviceInfo.os ||
              "unknown",

            userAgent:
              deviceInfo.userAgent ||
              null,
          },
        },
      });
    } catch (error) {
      console.error(
        "❌ Failed to log event:",
        error.message
      );
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
      console.error(
        "❌ Failed to cache user:",
        error.message
      );
    }

    // ============================================================
    // RESPONSE
    // ============================================================

    // Do not return password_hash.
    //
    // Also don't return the entire id_documents relation
    // in the normal login response.
    const {
      password_hash,
      id_documents,
      ...userWithoutPassword
    } = user;

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
        where: {
          id: sessionId,
        },

        data: {
          is_active: false,
          logged_out_at: new Date(),
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
          logged_out_at: new Date(),
        },
      });
    }

    await redisHelpers.del(
      `user:${userId}`
    );
  }

  // ============================================================
  // REFRESH TOKEN
  // ============================================================
  async refreshToken(refreshToken) {
    const decoded =
      this.verifyToken(
        refreshToken,
        true
      );

    if (!decoded) {
      throw new Error(
        "Invalid refresh token"
      );
    }

    const user =
      await prisma.user.findUnique({
        where: {
          id: decoded.id,
        },
      });

    if (!user) {
      throw new Error(
        "User not found"
      );
    }

    return this.generateTokens(
      user.id
    );
  }

  // ============================================================
  // VERIFY EMAIL
  // ============================================================
  async verifyEmail(token) {
    if (!token) {
      return {
        error: "invalid-token",
        message:
          "No verification token provided",
      };
    }

    // ----------------------------------------------------------
    // Find user
    // ----------------------------------------------------------
    const user =
      await prisma.user.findFirst({
        where: {
          email_verification_token:
            token,
        },
      });

    if (!user) {
      return {
        error: "invalid-token",
        message:
          "Invalid verification token",
      };
    }

    // ----------------------------------------------------------
    // Check expiration
    // ----------------------------------------------------------
    if (
      user.email_verification_expires &&
      new Date(
        user.email_verification_expires
      ) < new Date()
    ) {
      return {
        error: "token-expired",

        message:
          "Verification token has expired",

        email: user.email,

        needsNewToken: true,
      };
    }

    // ----------------------------------------------------------
    // Already verified
    // ----------------------------------------------------------
    if (user.email_verified) {
      return {
        error: "already-verified",

        message:
          "Email is already verified",

        email: user.email,
      };
    }

    // ----------------------------------------------------------
    // Determine new status
    //
    // Normal users become active.
    // Hosts remain pending until admin approval.
    // ----------------------------------------------------------
    let newStatus =
      user.status;

    if (user.role === "user") {
      newStatus =
        USER_STATUS.ACTIVE;
    }

    // ----------------------------------------------------------
    // Update user
    // ----------------------------------------------------------
    const updatedUser =
      await prisma.user.update({
        where: {
          id: user.id,
        },

        data: {
          email_verified: true,

          email_verification_token:
            null,

          email_verification_expires:
            null,

          status: newStatus,
        },
      });

    // ----------------------------------------------------------
    // Clear cache
    // ----------------------------------------------------------
    await redisHelpers.del(
      `user:${user.id}`
    );

    // ----------------------------------------------------------
    // Log event
    // ----------------------------------------------------------
    try {
      await prisma.userEvent.create({
        data: {
          user_id: user.id,

          event_type:
            "email_verified",

          metadata: {
            timestamp:
              new Date().toISOString(),

            token_used: true,
          },
        },
      });
    } catch (error) {
      console.error(
        "❌ Failed to log email verification:",
        error.message
      );
    }

    // ----------------------------------------------------------
    // Remove password
    // ----------------------------------------------------------
    const {
      password_hash,
      ...userWithoutPassword
    } = updatedUser;

    return {
      success: true,

      user: userWithoutPassword,

      message:
        "Email verified successfully",

      redirectTo: "/login",
    };
  }

  // ============================================================
  // REQUEST PASSWORD RESET
  // ============================================================
  async requestPasswordReset(email) {
    const normalizedEmail =
      email.trim().toLowerCase();

    const user =
      await prisma.user.findUnique({
        where: {
          email: normalizedEmail,
        },
      });

    if (!user) {
      throw new Error(
        "User not found"
      );
    }

    const resetToken =
      generateToken();

    const resetExpires =
      new Date(
        Date.now() +
          60 * 60 * 1000
      );

    await prisma.user.update({
      where: {
        id: user.id,
      },

      data: {
        reset_password_token:
          resetToken,

        reset_password_expires:
          resetExpires,
      },
    });

    try {
      await emailService.sendPasswordResetEmail(
        normalizedEmail,
        user.name,
        resetToken
      );
    } catch (error) {
      console.error(
        "Failed to send password reset email:",
        error
      );

      throw new Error(
        "Failed to send password reset email"
      );
    }

    return {
      message:
        "Password reset email sent",
    };
  }

  // ============================================================
  // RESET PASSWORD
  // ============================================================
  async resetPassword(
    token,
    newPassword
  ) {
    const user =
      await prisma.user.findFirst({
        where: {
          reset_password_token:
            token,

          reset_password_expires: {
            gt: new Date(),
          },
        },
      });

    if (!user) {
      throw new Error(
        "Invalid or expired reset token"
      );
    }

    const hashedPassword =
      await this.hashPassword(
        newPassword
      );

    await prisma.user.update({
      where: {
        id: user.id,
      },

      data: {
        password_hash:
          hashedPassword,

        reset_password_token:
          null,

        reset_password_expires:
          null,
      },
    });

    await prisma.userSession.updateMany({
      where: {
        user_id: user.id,
        is_active: true,
      },

      data: {
        is_active: false,
        logged_out_at: new Date(),
      },
    });

    return {
      message:
        "Password reset successfully",
    };
  }

  // ============================================================
  // GET USER BY ID
  // ============================================================
  async getUserById(userId) {
    const cachedUser =
      await redisHelpers.get(
        `user:${userId}`
      );

    if (cachedUser) {
      return cachedUser;
    }

    const user =
      await prisma.user.findUnique({
        where: {
          id: userId,
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
      throw new Error(
        "User not found"
      );
    }

    const {
      password_hash,
      ...userWithoutPassword
    } = user;

    await redisHelpers.set(
      `user:${userId}`,
      userWithoutPassword,
      3600
    );

    return userWithoutPassword;
  }

  // ============================================================
  // UPDATE USER
  // ============================================================
  async updateUser(
    userId,
    updateData
  ) {
    const {
      password_hash,
      email,
      role,
      ...safeData
    } = updateData;

    const user =
      await prisma.user.update({
        where: {
          id: userId,
        },

        data: safeData,
      });

    await redisHelpers.del(
      `user:${userId}`
    );

    const {
      password_hash: _,
      ...userWithoutPassword
    } = user;

    return userWithoutPassword;
  }

  // ============================================================
  // CHANGE PASSWORD
  // ============================================================
  async changePassword(
    userId,
    currentPassword,
    newPassword
  ) {
    const user =
      await prisma.user.findUnique({
        where: {
          id: userId,
        },

        select: {
          password_hash: true,
        },
      });

    if (!user) {
      throw new Error(
        "User not found"
      );
    }

    const isMatch =
      await this.comparePassword(
        currentPassword,
        user.password_hash
      );

    if (!isMatch) {
      throw new Error(
        "Current password is incorrect"
      );
    }

    const hashedPassword =
      await this.hashPassword(
        newPassword
      );

    await prisma.user.update({
      where: {
        id: userId,
      },

      data: {
        password_hash:
          hashedPassword,
      },
    });

    await prisma.userSession.updateMany({
      where: {
        user_id: userId,
        is_active: true,
      },

      data: {
        is_active: false,
        logged_out_at: new Date(),
      },
    });

    await redisHelpers.del(
      `user:${userId}`
    );

    return {
      message:
        "Password changed successfully",
    };
  }

  // ============================================================
  // RESEND EMAIL VERIFICATION
  // ============================================================
  async resendVerificationEmail(
    email
  ) {
    const normalizedEmail =
      email.trim().toLowerCase();

    const user =
      await prisma.user.findUnique({
        where: {
          email: normalizedEmail,
        },
      });

    if (!user) {
      throw new Error(
        "User not found"
      );
    }

    if (user.email_verified) {
      throw new Error(
        "Email is already verified"
      );
    }

    // ----------------------------------------------------------
    // Check whether existing token is still valid
    // ----------------------------------------------------------
    const hasValidToken =
      user.email_verification_token &&
      user.email_verification_expires &&
      new Date(
        user.email_verification_expires
      ) > new Date();

    // ----------------------------------------------------------
    // Generate new token
    // ----------------------------------------------------------
    if (!hasValidToken) {
      const verificationToken =
        generateToken();

      const verificationExpires =
        new Date(
          Date.now() +
            24 * 60 * 60 * 1000
        );

      await prisma.user.update({
        where: {
          id: user.id,
        },

        data: {
          email_verification_token:
            verificationToken,

          email_verification_expires:
            verificationExpires,
        },
      });

      const emailResult =
        await emailService.sendVerificationEmail(
          user.email,
          user.name,
          verificationToken
        );

      if (!emailResult.success) {
        throw new Error(
          emailResult.error ||
            "Failed to send verification email"
        );
      }

      return {
        message:
          "New verification email sent successfully",

        tokenExpiry:
          verificationExpires,
      };
    }

    // ----------------------------------------------------------
    // Existing token is still valid
    // ----------------------------------------------------------
    const emailResult =
      await emailService.sendVerificationEmail(
        user.email,
        user.name,
        user.email_verification_token
      );

    if (!emailResult.success) {
      throw new Error(
        emailResult.error ||
          "Failed to send verification email"
      );
    }

    return {
      message:
        "Verification email resent successfully",

      tokenExpiry:
        user.email_verification_expires,
    };
  }

  // ============================================================
  // CHECK VERIFICATION STATUS
  // ============================================================
  async checkVerificationStatus(
    email
  ) {
    const normalizedEmail =
      email.trim().toLowerCase();

    const user =
      await prisma.user.findUnique({
        where: {
          email: normalizedEmail,
        },

        select: {
          id: true,
          email: true,
          email_verified: true,

          email_verification_token:
            true,

          email_verification_expires:
            true,

          name: true,
        },
      });

    if (!user) {
      throw new Error(
        "User not found"
      );
    }

    const isTokenExpired =
      user.email_verification_expires &&
      new Date(
        user.email_verification_expires
      ) < new Date();

    return {
      email_verified:
        user.email_verified,

      needs_verification:
        !user.email_verified,

      token_expired:
        isTokenExpired,

      token:
        user.email_verification_token,

      token_expiry:
        user.email_verification_expires,

      email:
        user.email,

      name:
        user.name,
    };
  }

  // ============================================================
  // GENERATE NEW VERIFICATION TOKEN
  // ============================================================
  async generateNewVerificationToken(
    userId
  ) {
    const user =
      await prisma.user.findUnique({
        where: {
          id: userId,
        },
      });

    if (!user) {
      throw new Error(
        "User not found"
      );
    }

    if (user.email_verified) {
      throw new Error(
        "Email is already verified"
      );
    }

    const verificationToken =
      generateToken();

    const verificationExpires =
      new Date(
        Date.now() +
          24 * 60 * 60 * 1000
      );

    await prisma.user.update({
      where: {
        id: userId,
      },

      data: {
        email_verification_token:
          verificationToken,

        email_verification_expires:
          verificationExpires,
      },
    });

    const emailResult =
      await emailService.sendVerificationEmail(
        user.email,
        user.name,
        verificationToken
      );

    if (!emailResult.success) {
      throw new Error(
        emailResult.error ||
          "Failed to send verification email"
      );
    }

    return {
      message:
        "New verification token generated and email sent",

      tokenExpiry:
        verificationExpires,
    };
  }

  // ============================================================
  // CREATE HOST PROFILE
  // ============================================================
  async createHostProfile(
    userId,
    hostData
  ) {
    const user =
      await prisma.user.findUnique({
        where: {
          id: userId,
        },
      });

    if (!user) {
      throw new Error(
        "User not found"
      );
    }

    if (user.role === "host") {
      throw new Error(
        "User is already a host"
      );
    }

    // ----------------------------------------------------------
    // Old frontend may still send idImages.
    //
    // We deliberately remove it so it can never be written
    // into the User Prisma model.
    //
    // Actual ID documents belong in UserIdDocument.
    // ----------------------------------------------------------
    const {
      idImages,
      ...safeHostData
    } = hostData || {};

    const updatedUser =
      await prisma.user.update({
        where: {
          id: userId,
        },

        data: {
          role: "host",

          status:
            USER_STATUS.PENDING,

          host_details: {
            rating: 0,

            totalListings: 0,

            verified: false,

            id_verified: false,

            id_verified_at: null,

            id_rejected: false,

            id_rejection_reason:
              null,

            payment_verified:
              false,

            payment_verified_at:
              null,

            payment_rejected:
              false,

            payment_rejection_reason:
              null,

            notificationSent: {
              oneWeek: false,
              twoDays: false,
            },

            ...safeHostData,
          },
        },
      });

    // ----------------------------------------------------------
    // Send host verification email
    // ----------------------------------------------------------
    try {
      await emailService.sendHostVerificationEmail(
        user.email,
        user.name
      );
    } catch (error) {
      console.error(
        "Failed to send host verification email:",
        error
      );
    }

    // ----------------------------------------------------------
    // Remove password
    // ----------------------------------------------------------
    const {
      password_hash,
      ...userWithoutPassword
    } = updatedUser;

    return userWithoutPassword;
  }
}

// ============================================================
// EXPORT SINGLE AUTH SERVICE INSTANCE
// ============================================================
module.exports = new AuthService();