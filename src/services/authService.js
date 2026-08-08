//src/service/authService
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
    console.log('📝 Registering user:', { 
      email: userData.email, 
      name: userData.name,
      role: userData.role || 'user'
    });

    const { name, email, password, phone_number, role = 'user' } = userData;

    // Validate required fields
    if (!name || !email || !password || !phone_number) {
      console.error('❌ Missing required fields:', { name, email, password: !!password, phone_number });
      throw new Error('All fields are required: name, email, password, phone_number');
    }

    // Check if user exists
    const existingUser = await prisma.user.findUnique({ 
      where: { email: email.trim().toLowerCase() } 
    });
    
    if (existingUser) {
      console.log('⚠️ User already exists:', email);
      throw new Error('User already exists with this email');
    }

    // Hash password
    const hashedPassword = await this.hashPassword(password);

    // Generate verification token
    const verificationToken = generateToken();
    const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    console.log('✅ Creating user in database...');

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

    console.log('✅ User created successfully:', user.id);

    // Send verification email (non-blocking)
    try {
      console.log('📧 Sending verification email...');
      await emailService.sendVerificationEmail(email, name, verificationToken);
      console.log('✅ Verification email sent');
    } catch (error) {
      // Log error but don't fail registration
      console.error('❌ Failed to send verification email:', error.message);
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
      console.log('✅ Session created');
    } catch (error) {
      console.error('❌ Failed to create session:', error.message);
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
  console.log('🔐 Login attempt:', { email });

  // Normalize email
  const normalizedEmail = email.trim().toLowerCase();

  // ─── Find user ─────────────────────────────────────────────
  const user = await prisma.user.findUnique({
    where: { email: normalizedEmail },
  });

  if (!user) {
    console.log('❌ User not found:', normalizedEmail);
    throw new Error('Invalid credentials');
  }

  // ─── Email verification check ─────────────────────────────
  if (!user.email_verified) {
    console.log('❌ Email not verified:', normalizedEmail);
    throw new Error('Please verify your email address before logging in.');
  }

  // ─── Password check ────────────────────────────────────────
  const isMatch = await this.comparePassword(password, user.password_hash);
  if (!isMatch) {
    console.log('❌ Invalid password:', normalizedEmail);
    throw new Error('Invalid credentials');
  }

  console.log('✅ Login successful:', normalizedEmail);

  // ─── Host logic ────────────────────────────────────────────
  let loginMessage = 'Login successful';
  let requiresIdUpload = false;
  let isHostApproved = true;

  if (user.role === 'host') {
    const hasIdImages = user.id_images && user.id_images.length > 0;

    if (user.status === 'pending') {
      if (!hasIdImages) {
        requiresIdUpload = true;
        loginMessage = 'Please upload your ID/Passport to complete verification';
      } else {
        loginMessage = 'Your host account is pending admin approval.';
        isHostApproved = false;
      }
    } else if (user.status === 'suspended') {
      console.log('❌ Account suspended:', normalizedEmail);
      throw new Error('Your account has been suspended.');
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
        device: deviceInfo.device || 'desktop',
        browser: deviceInfo.browser || 'unknown',
        os: deviceInfo.os || 'unknown',
        ip_address: deviceInfo.ip || null,
        user_agent: deviceInfo.userAgent || null,
        is_active: true,
        logged_in_at: new Date(),
      },
    });
  } catch (error) {
    console.error('❌ Failed to create session:', error.message);
  }

  // ─── Log event ─────────────────────────────────────────────
  try {
    await prisma.userEvent.create({
      data: {
        user_id: user.id,
        event_type: 'login',
        metadata: {
          ip: deviceInfo.ip || null,
          device: deviceInfo.device || 'desktop',
          browser: deviceInfo.browser || 'unknown',
          os: deviceInfo.os || 'unknown',
          userAgent: deviceInfo.userAgent || null,
        },
      },
    });
  } catch (error) {
    console.error('❌ Failed to log event:', error.message);
  }

  // ─── Cache user data (non-blocking) ───────────────────────
  try {
    await redisHelpers.set(`user:${user.id}`, {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      status: user.status,
      requiresIdUpload,
      isHostApproved,
    }, 3600);
  } catch (error) {
    console.error('❌ Failed to cache user:', error.message);
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

}

module.exports = new AuthService();