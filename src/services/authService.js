const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { prisma } = require("../config/database");
const { redisHelpers } = require("../config/redis");
const emailService = require("./emailService");
const { generateToken, generateOTP } = require("../utils/helpers");
const { USER_STATUS } = require("../utils/constants");

class AuthService {
  // Hash password
  async hashPassword(password) {
    const salt = await bcrypt.genSalt(10);
    return bcrypt.hash(password, salt);
  }

  // Compare password
  async comparePassword(password, hashedPassword) {
    return bcrypt.compare(password, hashedPassword);
  }

  // Generate JWT tokens
  generateTokens(userId) {
    const accessToken = jwt.sign(
      { id: userId },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRE || "30d" }
    );

    const refreshToken = jwt.sign(
      { id: userId },
      process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_REFRESH_EXPIRE || "7d" }
    );

    return { accessToken, refreshToken };
  }

  // Verify token
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

  // Register user
  async register(userData) {
    console.log("📝 Registering user:", {
      email: userData.email,
      name: userData.name,
      role: userData.role || "user",
    });

    const { name, email, password, phone_number, role = "user" } = userData;

    // Validate required fields
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

    // Check if user exists
    const existingUser = await prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
    });

    if (existingUser) {
      console.log("⚠️ User already exists:", email);
      throw new Error("User already exists with this email");
    }

    // Hash password
    const hashedPassword = await this.hashPassword(password);

    // Generate verification token
    const verificationToken = generateToken();
    const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    console.log("✅ Creating user in database...");

    // Create user
    const user = await prisma.user.create({
      data: {
        name: name.trim(),
        email: email.trim().toLowerCase(),
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
          notificationSent: {
            oneWeek: false,
            twoDays: false,
          },
        },
        user_details: {
          preferences: {},
          bookings: [],
        },
        id_images: [],
      },
    });

    console.log("✅ User created successfully:", user.id);

    // ─── Send verification email with retry ─────────────────────
    let emailSent = false;
    let emailError = null;

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        console.log(`📧 Sending verification email (attempt ${attempt}/3)...`);
        const emailResult = await emailService.sendVerificationEmail(
          email,
          name,
          verificationToken
        );

        if (emailResult.success) {
          console.log(`✅ Verification email sent: ${emailResult.messageId}`);
          emailSent = true;
          break;
        } else {
          emailError = emailResult.error;
          console.error(`❌ Attempt ${attempt} failed:`, emailResult.error);
        }
      } catch (error) {
        emailError = error.message;
        console.error(`❌ Attempt ${attempt} failed:`, error.message);
      }

      // Wait before retry
      if (attempt < 3) {
        console.log(`⏳ Waiting 2 seconds before retry...`);
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    if (!emailSent) {
      console.error(`❌ All email attempts failed: ${emailError}`);
      // Don't throw - user can resend verification later
      // But we log it for debugging
    }

    // Generate tokens
    const tokens = this.generateTokens(user.id);

    // Create session (non-blocking)
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
      console.error("❌ Failed to create session:", error.message);
    }

    // Remove sensitive data
    const { password_hash, ...userWithoutPassword } = user;

    return {
      user: userWithoutPassword,
      tokens,
    };
  }

  // Login user
  async login(email, password, deviceInfo = {}) {
    console.log("🔐 Login attempt:", { email });

    // Normalize email
    const normalizedEmail = email.trim().toLowerCase();

    // ─── Find user ─────────────────────────────────────────────
    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (!user) {
      console.log("❌ User not found:", normalizedEmail);
      throw new Error("Invalid credentials");
    }

    // ─── Email verification check ─────────────────────────────
    if (!user.email_verified) {
      console.log("❌ Email not verified:", normalizedEmail);
      throw new Error("Please verify your email address before logging in.");
    }

    // ─── Password check ────────────────────────────────────────
    const isMatch = await this.comparePassword(password, user.password_hash);
    if (!isMatch) {
      console.log("❌ Invalid password:", normalizedEmail);
      throw new Error("Invalid credentials");
    }

    console.log("✅ Login successful:", normalizedEmail);

    // ─── Host logic ────────────────────────────────────────────
    let loginMessage = "Login successful";
    let requiresIdUpload = false;
    let isHostApproved = true;

    if (user.role === "host") {
      const hasIdImages = user.id_images && user.id_images.length > 0;

      if (user.status === "pending") {
        if (!hasIdImages) {
          requiresIdUpload = true;
          loginMessage =
            "Please upload your ID/Passport to complete verification";
        } else {
          loginMessage = "Your host account is pending admin approval.";
          isHostApproved = false;
        }
      } else if (user.status === "suspended") {
        console.log("❌ Account suspended:", normalizedEmail);
        throw new Error("Your account has been suspended.");
      }
    }

    // ─── Update last active ────────────────────────────────────
    await prisma.user.update({
      where: { id: user.id },
      data: { last_active: new Date() },
    });

    // ─── Reset old sessions ────────────────────────────────────
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

    // ─── Generate tokens ───────────────────────────────────────
    const tokens = this.generateTokens(user.id);

    // ─── Create session ────────────────────────────────────────
    try {
      await prisma.userSession.create({
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
    }

    // ─── Log event ─────────────────────────────────────────────
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

    // ─── Cache user data (non-blocking) ───────────────────────
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

    // ─── Response ──────────────────────────────────────────────
    const { password_hash, ...userWithoutPassword } = user;

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

  // Logout user
  async logout(userId, sessionId = null) {
    if (sessionId) {
      await prisma.userSession.update({
        where: { id: sessionId },
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

    await redisHelpers.del(`user:${userId}`);
  }

  // Refresh token
  async refreshToken(refreshToken) {
    const decoded = this.verifyToken(refreshToken, true);
    if (!decoded) {
      throw new Error("Invalid refresh token");
    }

    const user = await prisma.user.findUnique({
      where: { id: decoded.id },
    });

    if (!user) {
      throw new Error("User not found");
    }

    return this.generateTokens(user.id);
  }

  // Verify email
  async verifyEmail(token) {
    const user = await prisma.user.findFirst({
      where: {
        email_verification_token: token,
        email_verification_expires: {
          gt: new Date(),
        },
      },
    });

    if (!user) {
      throw new Error("Invalid or expired verification token");
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        email_verified: true,
        email_verification_token: null,
        email_verification_expires: null,
        status: USER_STATUS.ACTIVE,
      },
    });

    return user;
  }

  // Request password reset
  async requestPasswordReset(email) {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      throw new Error("User not found");
    }

    const resetToken = generateToken();
    const resetExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await prisma.user.update({
      where: { id: user.id },
      data: {
        reset_password_token: resetToken,
        reset_password_expires: resetExpires,
      },
    });

    try {
      await emailService.sendPasswordResetEmail(email, user.name, resetToken);
    } catch (error) {
      console.error("Failed to send password reset email:", error);
      throw new Error("Failed to send password reset email");
    }

    return { message: "Password reset email sent" };
  }

  // Reset password
  async resetPassword(token, newPassword) {
    const user = await prisma.user.findFirst({
      where: {
        reset_password_token: token,
        reset_password_expires: {
          gt: new Date(),
        },
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

    await prisma.userSession.updateMany({
      where: { user_id: user.id, is_active: true },
      data: {
        is_active: false,
        logged_out_at: new Date(),
      },
    });

    return { message: "Password reset successfully" };
  }

  // Get user by ID
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
        bookings: {
          take: 5,
          orderBy: { created_at: "desc" },
        },
      },
    });

    if (!user) {
      throw new Error("User not found");
    }

    const { password_hash, ...userWithoutPassword } = user;
    await redisHelpers.set(`user:${userId}`, userWithoutPassword, 3600);

    return userWithoutPassword;
  }

  // Update user
  async updateUser(userId, updateData) {
    const { password_hash, email, role, ...safeData } = updateData;

    const user = await prisma.user.update({
      where: { id: userId },
      data: safeData,
    });

    await redisHelpers.del(`user:${userId}`);

    const { password_hash: _, ...userWithoutPassword } = user;
    return userWithoutPassword;
  }

  // Change password
  async changePassword(userId, currentPassword, newPassword) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { password_hash: true },
    });

    const isMatch = await this.comparePassword(currentPassword, user.password_hash);
    if (!isMatch) {
      throw new Error("Current password is incorrect");
    }

    const hashedPassword = await this.hashPassword(newPassword);

    await prisma.user.update({
      where: { id: userId },
      data: { password_hash: hashedPassword },
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

    return { message: "Password changed successfully" };
  }

  // Create host profile
  async createHostProfile(userId, hostData) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new Error("User not found");
    }

    if (user.role === "host") {
      throw new Error("User is already a host");
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        role: "host",
        status: USER_STATUS.PENDING,
        host_details: {
          rating: 0,
          totalListings: 0,
          verified: false,
          notificationSent: {
            oneWeek: false,
            twoDays: false,
          },
          ...hostData,
        },
        id_images: hostData.idImages || [],
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