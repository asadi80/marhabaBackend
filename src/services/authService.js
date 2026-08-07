const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { prisma } = require('../config/database');
const { redisHelpers } = require('../config/redis');
const emailService = require('./emailService');
const { generateToken, generateOTP } = require('../utils/helpers');
const { USER_STATUS } = require('../utils/constants');

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
      { expiresIn: process.env.JWT_EXPIRE || '30d' }
    );

    const refreshToken = jwt.sign(
      { id: userId },
      process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_REFRESH_EXPIRE || '7d' }
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
    const { name, email, password, phone_number, role = 'user' } = userData;

    // Check if user exists
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      throw new Error('User already exists');
    }

    // Hash password
    const hashedPassword = await this.hashPassword(password);

    // Generate verification token
    const verificationToken = generateToken();
    const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    // Create user
    const user = await prisma.user.create({
      data: {
        name,
        email,
        password_hash: hashedPassword,
        phone_number,
        role,
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

    // Send verification email
    try {
      await emailService.sendVerificationEmail(email, name, verificationToken);
    } catch (error) {
      console.error('Failed to send verification email:', error);
    }

    // Generate tokens
    const tokens = this.generateTokens(user.id);

    // Create session
    await prisma.userSession.create({
      data: {
        user_id: user.id,
        is_active: true,
        logged_in_at: new Date(),
      },
    });

    // Remove sensitive data
    const { password_hash, ...userWithoutPassword } = user;

    return {
      user: userWithoutPassword,
      tokens,
    };
  }

  // Login user
  async login(email, password, deviceInfo = {}) {
    // Find user
    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      throw new Error('Invalid credentials');
    }

    // Check if user is active
    if (user.status === USER_STATUS.SUSPENDED || user.status === USER_STATUS.BANNED) {
      throw new Error(`Account is ${user.status}`);
    }

    // Check password
    const isMatch = await this.comparePassword(password, user.password_hash);
    if (!isMatch) {
      throw new Error('Invalid credentials');
    }

    // Update last active
    await prisma.user.update({
      where: { id: user.id },
      data: { last_active: new Date() },
    });

    // Generate tokens
    const tokens = this.generateTokens(user.id);

    // Create session
    await prisma.userSession.create({
      data: {
        user_id: user.id,
        device: deviceInfo.device || null,
        browser: deviceInfo.browser || null,
        os: deviceInfo.os || null,
        ip_address: deviceInfo.ip || null,
        user_agent: deviceInfo.userAgent || null,
        is_active: true,
        logged_in_at: new Date(),
      },
    });

    // Cache user data
    await redisHelpers.set(`user:${user.id}`, {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    }, 3600);

    const { password_hash, ...userWithoutPassword } = user;

    return {
      user: userWithoutPassword,
      tokens,
    };
  }

  // Logout user
  async logout(userId, sessionId = null) {
    if (sessionId) {
      // Logout specific session
      await prisma.userSession.update({
        where: { id: sessionId },
        data: {
          is_active: false,
          logged_out_at: new Date(),
        },
      });
    } else {
      // Logout all sessions
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

    // Remove cached user data
    await redisHelpers.del(`user:${userId}`);
  }

  // Refresh token
  async refreshToken(refreshToken) {
    const decoded = this.verifyToken(refreshToken, true);
    if (!decoded) {
      throw new Error('Invalid refresh token');
    }

    const user = await prisma.user.findUnique({
      where: { id: decoded.id },
    });

    if (!user) {
      throw new Error('User not found');
    }

    // Generate new tokens
    const tokens = this.generateTokens(user.id);

    return tokens;
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
      throw new Error('Invalid or expired verification token');
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
      throw new Error('User not found');
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

    // Send password reset email
    try {
      await emailService.sendPasswordResetEmail(email, user.name, resetToken);
    } catch (error) {
      console.error('Failed to send password reset email:', error);
      throw new Error('Failed to send password reset email');
    }

    return { message: 'Password reset email sent' };
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
      throw new Error('Invalid or expired reset token');
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

    // Invalidate all sessions
    await prisma.userSession.updateMany({
      where: { user_id: user.id, is_active: true },
      data: {
        is_active: false,
        logged_out_at: new Date(),
      },
    });

    return { message: 'Password reset successfully' };
  }

  // Get user by ID
  async getUserById(userId) {
    // Try cache first
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
          orderBy: { created_at: 'desc' },
        },
        bookings: {
          take: 5,
          orderBy: { created_at: 'desc' },
        },
      },
    });

    if (!user) {
      throw new Error('User not found');
    }

    const { password_hash, ...userWithoutPassword } = user;
    
    // Cache for 1 hour
    await redisHelpers.set(`user:${userId}`, userWithoutPassword, 3600);

    return userWithoutPassword;
  }

  // Update user
  async updateUser(userId, updateData) {
    // Remove sensitive fields that shouldn't be updated here
    const { password_hash, email, role, ...safeData } = updateData;

    const user = await prisma.user.update({
      where: { id: userId },
      data: safeData,
    });

    // Clear cache
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
      throw new Error('Current password is incorrect');
    }

    const hashedPassword = await this.hashPassword(newPassword);

    await prisma.user.update({
      where: { id: userId },
      data: { password_hash: hashedPassword },
    });

    // Invalidate all sessions except current
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

    return { message: 'Password changed successfully' };
  }

  // Create host profile
  async createHostProfile(userId, hostData) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new Error('User not found');
    }

    if (user.role === 'host') {
      throw new Error('User is already a host');
    }

    // Update user to host
    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        role: 'host',
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

    // Send host verification email
    try {
      await emailService.sendHostVerificationEmail(user.email, user.name);
    } catch (error) {
      console.error('Failed to send host verification email:', error);
    }

    const { password_hash, ...userWithoutPassword } = updatedUser;
    return userWithoutPassword;
  }
}

module.exports = new AuthService();