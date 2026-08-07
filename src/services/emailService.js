const nodemailer = require('nodemailer');

class EmailService {
  constructor() {
    // Check for both EMAIL_* and SMTP_* variables
    const host = process.env.EMAIL_HOST || process.env.SMTP_HOST;
    const port = parseInt(process.env.EMAIL_PORT || process.env.SMTP_PORT || '587');
    const user = process.env.EMAIL_USER || process.env.SMTP_USER;
    const pass = process.env.EMAIL_PASS || process.env.SMTP_PASS;
    const from = process.env.EMAIL_FROM || process.env.SMTP_FROM || user;
    const secure = process.env.EMAIL_SECURE === 'true' || process.env.SMTP_SECURE === 'true' || port === 465;

    if (host && user && pass) {
      this.transporter = nodemailer.createTransport({
        host: host,
        port: port,
        secure: secure,
        auth: {
          user: user,
          pass: pass,
        },
        tls: {
          rejectUnauthorized: false,
        },
        // For self-signed certificates
        ignoreTLS: false,
      });
      
      this.fromEmail = from;
      console.log('✅ Email service initialized with:', { host, port, user, secure });
    } else {
      console.warn('⚠️ Email not configured. Missing:', {
        host: !!host,
        user: !!user,
        pass: !!pass
      });
      this.transporter = null;
      this.fromEmail = null;
    }
  }

  async sendVerificationEmail(email, name, token) {
    if (!this.transporter) {
      console.warn('⚠️ Email service disabled, skipping email send');
      return { messageId: 'disabled', skipped: true };
    }

    try {
      const verificationUrl = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/verify-email?token=${token}`;
      
      const mailOptions = {
        from: `"Marhaba" <${this.fromEmail}>`,
        to: email,
        subject: 'Verify Your Email - Marhaba',
        html: `
          <!DOCTYPE html>
          <html>
          <head>
            <style>
              body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
              .header { background: #1a1a2e; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
              .header h1 { color: #e8c547; margin: 0; }
              .content { background: #f7f6f2; padding: 30px; border-radius: 0 0 8px 8px; }
              .btn { display: inline-block; padding: 12px 24px; background: #1a1a2e; color: #e8c547; text-decoration: none; border-radius: 4px; margin: 20px 0; }
              .footer { margin-top: 20px; font-size: 12px; color: #999; text-align: center; }
            </style>
          </head>
          <body>
            <div class="header">
              <h1>مرحبا / Marhaba</h1>
            </div>
            <div class="content">
              <h2>Welcome to Marhaba, ${name}!</h2>
              <p>Thank you for registering. Please verify your email address to get started.</p>
              <p style="text-align: center;">
                <a href="${verificationUrl}" class="btn">Verify Email Address</a>
              </p>
              <p>Or copy and paste this link in your browser:</p>
              <p><code style="background: #eee; padding: 8px; display: block; word-break: break-all; border-radius: 4px;">${verificationUrl}</code></p>
              <p>This link will expire in <strong>24 hours</strong>.</p>
              <p>If you didn't create an account, please ignore this email.</p>
            </div>
            <div class="footer">
              <p>&copy; ${new Date().getFullYear()} Marhaba. All rights reserved.</p>
            </div>
          </body>
          </html>
        `,
        text: `
          Welcome to Marhaba, ${name}!
          
          Please verify your email address by visiting this link:
          ${verificationUrl}
          
          This link will expire in 24 hours.
          
          If you didn't create an account, please ignore this email.
        `,
      };

      console.log(`📧 Sending verification email to ${email}...`);
      const info = await this.transporter.sendMail(mailOptions);
      console.log(`✅ Verification email sent to ${email}:`, info.messageId);
      return info;
    } catch (error) {
      console.error('❌ Email send failed:', error.message);
      // Log full error for debugging
      if (error.code) console.error('Error code:', error.code);
      if (error.command) console.error('Command:', error.command);
      throw new Error(`Failed to send verification email: ${error.message}`);
    }
  }

  async sendPasswordResetEmail(email, name, token) {
    if (!this.transporter) {
      console.warn('⚠️ Email service disabled, skipping email send');
      return { messageId: 'disabled', skipped: true };
    }

    try {
      const resetUrl = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/reset-password?token=${token}`;
      
      const mailOptions = {
        from: `"Marhaba" <${this.fromEmail}>`,
        to: email,
        subject: 'Reset Your Password - Marhaba',
        html: `
          <!DOCTYPE html>
          <html>
          <head>
            <style>
              body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
              .header { background: #1a1a2e; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
              .header h1 { color: #e8c547; margin: 0; }
              .content { background: #f7f6f2; padding: 30px; border-radius: 0 0 8px 8px; }
              .btn { display: inline-block; padding: 12px 24px; background: #e8c547; color: #1a1a2e; text-decoration: none; border-radius: 4px; margin: 20px 0; }
            </style>
          </head>
          <body>
            <div class="header">
              <h1>مرحبا / Marhaba</h1>
            </div>
            <div class="content">
              <h2>Reset Your Password</h2>
              <p>Hello ${name},</p>
              <p>We received a request to reset your password. Click the button below to reset it:</p>
              <p style="text-align: center;">
                <a href="${resetUrl}" class="btn">Reset Password</a>
              </p>
              <p>Or copy and paste this link in your browser:</p>
              <p><code style="background: #eee; padding: 8px; display: block; word-break: break-all; border-radius: 4px;">${resetUrl}</code></p>
              <p>This link will expire in <strong>1 hour</strong>.</p>
              <p>If you didn't request this, please ignore this email.</p>
            </div>
          </body>
          </html>
        `,
        text: `
          Reset Your Password
          
          Hello ${name},
          
          We received a request to reset your password. Visit this link to reset it:
          ${resetUrl}
          
          This link will expire in 1 hour.
          
          If you didn't request this, please ignore this email.
        `,
      };

      const info = await this.transporter.sendMail(mailOptions);
      console.log(`✅ Password reset email sent to ${email}`);
      return info;
    } catch (error) {
      console.error('❌ Password reset email failed:', error.message);
      throw new Error(`Failed to send password reset email: ${error.message}`);
    }
  }

  async sendHostVerificationEmail(email, name) {
    if (!this.transporter) {
      console.warn('⚠️ Email service disabled, skipping email send');
      return { messageId: 'disabled', skipped: true };
    }

    try {
      const mailOptions = {
        from: `"Marhaba" <${this.fromEmail}>`,
        to: email,
        subject: 'Host Account Verified - Marhaba',
        html: `
          <!DOCTYPE html>
          <html>
          <head>
            <style>
              body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
              .header { background: #1a1a2e; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
              .header h1 { color: #e8c547; margin: 0; }
              .content { background: #f7f6f2; padding: 30px; border-radius: 0 0 8px 8px; }
              .btn { display: inline-block; padding: 12px 24px; background: #1a1a2e; color: #e8c547; text-decoration: none; border-radius: 4px; margin: 20px 0; }
            </style>
          </head>
          <body>
            <div class="header">
              <h1>مرحبا / Marhaba</h1>
            </div>
            <div class="content">
              <h2>Congratulations, ${name}!</h2>
              <p>Your host account has been verified successfully.</p>
              <p>You can now start listing your properties and accepting bookings.</p>
              <p style="text-align: center;">
                <a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}/dashboard" class="btn">Go to Dashboard</a>
              </p>
            </div>
          </body>
          </html>
        `,
        text: `
          Congratulations, ${name}!
          
          Your host account has been verified successfully.
          
          You can now start listing your properties and accepting bookings.
        `,
      };

      const info = await this.transporter.sendMail(mailOptions);
      console.log(`✅ Host verification email sent to ${email}`);
      return info;
    } catch (error) {
      console.error('❌ Host verification email failed:', error.message);
      throw new Error(`Failed to send host verification email: ${error.message}`);
    }
  }
}

module.exports = new EmailService();