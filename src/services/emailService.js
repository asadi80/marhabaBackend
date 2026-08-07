const nodemailer = require('nodemailer');

class EmailService {
  constructor() {
    this.transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT),
      secure: process.env.SMTP_PORT === '465',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
      tls: {
        rejectUnauthorized: false,
      },
    });
  }

  async sendEmail(options) {
    try {
      const mailOptions = {
        from: `"MVP App" <${process.env.SMTP_USER}>`,
        to: options.email,
        subject: options.subject,
        html: options.html,
        text: options.text,
      };

      const info = await this.transporter.sendMail(mailOptions);
      console.log('📧 Email sent:', info.messageId);
      return info;
    } catch (error) {
      console.error('❌ Email sending failed:', error);
      throw new Error('Email sending failed');
    }
  }

  async sendVerificationEmail(email, name, token) {
    const verificationUrl = `${process.env.FRONTEND_URL}/verify-email?token=${token}`;
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .btn { display: inline-block; padding: 12px 24px; background: #4CAF50; color: white; text-decoration: none; border-radius: 4px; }
        </style>
      </head>
      <body>
        <div class="container">
          <h2>Welcome to MVP App, ${name}!</h2>
          <p>Please verify your email address to get started.</p>
          <p>
            <a href="${verificationUrl}" class="btn">Verify Email</a>
          </p>
          <p>Or copy and paste this link in your browser:</p>
          <p><code>${verificationUrl}</code></p>
          <p>This link will expire in 24 hours.</p>
          <p>If you didn't create an account, please ignore this email.</p>
        </div>
      </body>
      </html>
    `;

    return this.sendEmail({
      email,
      subject: 'Verify Your Email - MVP App',
      html,
    });
  }

  async sendPasswordResetEmail(email, name, token) {
    const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${token}`;
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .btn { display: inline-block; padding: 12px 24px; background: #f44336; color: white; text-decoration: none; border-radius: 4px; }
        </style>
      </head>
      <body>
        <div class="container">
          <h2>Reset Your Password</h2>
          <p>Hello ${name},</p>
          <p>We received a request to reset your password. Click the button below to reset it:</p>
          <p>
            <a href="${resetUrl}" class="btn">Reset Password</a>
          </p>
          <p>Or copy and paste this link in your browser:</p>
          <p><code>${resetUrl}</code></p>
          <p>This link will expire in 1 hour.</p>
          <p>If you didn't request this, please ignore this email.</p>
        </div>
      </body>
      </html>
    `;

    return this.sendEmail({
      email,
      subject: 'Reset Your Password - MVP App',
      html,
    });
  }

  async sendHostVerificationEmail(email, name) {
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .btn { display: inline-block; padding: 12px 24px; background: #2196F3; color: white; text-decoration: none; border-radius: 4px; }
        </style>
      </head>
      <body>
        <div class="container">
          <h2>Congratulations, ${name}!</h2>
          <p>Your host account has been verified successfully.</p>
          <p>You can now start listing your properties and accepting bookings.</p>
          <p>
            <a href="${process.env.FRONTEND_URL}/dashboard" class="btn">Go to Dashboard</a>
          </p>
        </div>
      </body>
      </html>
    `;

    return this.sendEmail({
      email,
      subject: 'Host Account Verified - MVP App',
      html,
    });
  }

  async sendBookingConfirmationEmail(email, name, bookingDetails) {
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .details { background: #f5f5f5; padding: 15px; border-radius: 4px; }
        </style>
      </head>
      <body>
        <div class="container">
          <h2>Booking Confirmed!</h2>
          <p>Hello ${name},</p>
          <p>Your booking has been confirmed. Here are the details:</p>
          <div class="details">
            <p><strong>Listing:</strong> ${bookingDetails.listingTitle}</p>
            <p><strong>Check-in:</strong> ${new Date(bookingDetails.checkIn).toLocaleDateString()}</p>
            <p><strong>Check-out:</strong> ${new Date(bookingDetails.checkOut).toLocaleDateString()}</p>
            <p><strong>Guests:</strong> ${bookingDetails.guests}</p>
            <p><strong>Total Price:</strong> $${bookingDetails.totalPrice}</p>
          </div>
          <p>
            <a href="${process.env.FRONTEND_URL}/bookings/${bookingDetails.id}" class="btn">View Booking</a>
          </p>
        </div>
      </body>
      </html>
    `;

    return this.sendEmail({
      email,
      subject: 'Booking Confirmed - MVP App',
      html,
    });
  }
}

module.exports = new EmailService();