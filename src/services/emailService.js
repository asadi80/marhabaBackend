const nodemailer = require('nodemailer');
console.log('🔧 EmailService file loaded');
class EmailService {
  constructor() {
    // Use the same configuration that works in Next.js
    this.host = process.env.EMAIL_HOST || "65.109.38.16";
    this.port = parseInt(process.env.EMAIL_PORT) || 465;
    this.secure = process.env.EMAIL_SECURE === 'true' || true;
    this.user = process.env.EMAIL_USER;
    this.pass = process.env.EMAIL_PASS;
    this.from = process.env.EMAIL_FROM || process.env.EMAIL_USER;

    console.log('📧 Email Configuration:');
    console.log('  Host:', this.host);
    console.log('  Port:', this.port);
    console.log('  Secure:', this.secure);
    console.log('  User:', this.user ? 'SET' : 'NOT SET');
    console.log('  Pass:', this.pass ? 'SET' : 'NOT SET');
  }

  async sendEmail({ to, subject, text, html }) {
    if (!this.user || !this.pass) {
      console.error('❌ Email configuration missing');
      return {
        success: false,
        error: 'Email configuration missing',
      };
    }

    try {
      console.log(`📧 Sending email to: ${to}`);
      
      const transporter = nodemailer.createTransport({
        host: this.host,
        port: this.port,
        secure: this.secure,
        auth: {
          user: this.user,
          pass: this.pass,
        },
        tls: {
          rejectUnauthorized: false,
          servername: 'mail.mar-haba.ly', // Important for SSL
        },
        // Timeouts
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 10000,
      });

      // Verify connection
      await transporter.verify();
      console.log('✅ SMTP connection verified');

      const info = await transporter.sendMail({
        from: `"Marhaba" <${this.from}>`,
        to,
        subject,
        text: text || html?.replace(/<[^>]*>/g, "") || "",
        html: html || text?.replace(/\n/g, "<br>") || "",
      });

      console.log(`✅ Email sent: ${info.messageId}`);
      
      return {
        success: true,
        messageId: info.messageId,
      };
    } catch (error) {
      console.error('❌ Email error:', error.message);
      if (error.code) console.error('  Code:', error.code);
      if (error.command) console.error('  Command:', error.command);
      return {
        success: false,
        error: error.message,
        code: error.code,
      };
    }
  }

  async sendVerificationEmail(email, name, token) {
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const verificationUrl = `${frontendUrl}/api/auth/verify-email?token=${token}`;

    const emailHtml = `
<div style="font-family: Arial, 'Cairo', 'Tajawal', sans-serif; max-width: 600px; margin: auto; padding: 20px;">
  
  <!-- English Section -->
  <div style="margin-bottom: 30px;">
    <h2 style="color: #4F46E5;">✓ Welcome to Marhaba!</h2>
    
    <p>Hi ${name},</p>
    
    <p>Thank you for registering with Marhaba! Please verify your email address to complete your registration.</p>
    
    <div style="background: #f3f4f6; padding: 15px; border-radius: 8px; margin: 20px 0; text-align: center;">
      <a href="${verificationUrl}" 
         style="background-color: #4F46E5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block;">
        Verify Email Address →
      </a>
    </div>
    
    <p>Or copy and paste this link in your browser:</p>
    <p style="background: #e5e7eb; padding: 10px; border-radius: 5px; word-break: break-all; font-size: 12px;">${verificationUrl}</p>
    
    <p>This link will expire in 24 hours.</p>
    
    <p style="margin-top: 20px;">Best regards,<br/>Marhaba Team</p>
  </div>
  
  <div style="border-top: 2px solid #e5e7eb; margin: 20px 0;"></div>
  
  <!-- Arabic Section -->
  <div style="direction: rtl; text-align: right;">
    <h2 style="color: #4F46E5;">✓ مرحباً بك في مرحبا!</h2>
    
    <p>مرحباً ${name}،</p>
    
    <p>شكراً لتسجيلك مع مرحبا! يرجى تأكيد عنوان بريدك الإلكتروني لإكمال تسجيلك.</p>
    
    <div style="background: #f3f4f6; padding: 15px; border-radius: 8px; margin: 20px 0; text-align: center;">
      <a href="${verificationUrl}" 
         style="background-color: #4F46E5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block;">
        تأكيد البريد الإلكتروني ←
      </a>
    </div>
    
    <p>أو انسخ هذا الرابط والصقه في المتصفح:</p>
    <p style="background: #e5e7eb; padding: 10px; border-radius: 5px; word-break: break-all; font-size: 12px;">${verificationUrl}</p>
    
    <p>هذا الرابط سينتهي صلاحيته خلال 24 ساعة.</p>
    
    <p style="margin-top: 20px;">مع أطيب التحيات،<br/>فريق مرحبا</p>
  </div>
</div>
    `;

    return this.sendEmail({
      to: email,
      subject: "Welcome to Marhaba! Please verify your email / مرحباً بك في مرحبا! يرجى تأكيد بريدك الإلكتروني",
      text: `Welcome to Marhaba! Please verify your email by clicking this link: ${verificationUrl}`,
      html: emailHtml,
    });
  }

  // Add other email methods (password reset, host verification, etc.)
}

module.exports = new EmailService();