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

  // Helper function to format date for email
  formatDateForEmail(date) {
    if (!date) return 'N/A';
    const d = new Date(date);
    return d.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  }

  async sendVerificationEmail(email, name, token) {
    const frontendUrl = process.env.BASE_URL || 'http://localhost:5173';
    const verificationUrl = `${frontendUrl}/api/v1/auth/verify-email?token=${token}`;

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

  async sendAdminWelcomeEmail(email, name, role) {
    const loginUrl = process.env.DASHBOARD_URL || "https://dashboard.dmar-haba.ly";

    const roleLabel =
      role === "super_admin"
        ? "Super Administrator"
        : "Administrator";

    const emailHtml = `
<div style="font-family: Arial, 'Cairo', 'Tajawal', sans-serif; max-width: 600px; margin: auto; padding: 30px;">

  <!-- English -->
  <div style="margin-bottom: 35px;">
    <h2 style="color: #1a1a2e;">
      Welcome to Marhaba Admin
    </h2>

    <p>Hello ${name},</p>

    <p>
      Your Marhaba administrator account has been created successfully.
    </p>

    <div style="
      background: #f7f6f2;
      padding: 20px;
      border-radius: 8px;
      margin: 20px 0;
    ">
      <p style="margin: 0 0 10px;">
        <strong>Account type:</strong> ${roleLabel}
      </p>

      <p style="margin: 0;">
        <strong>Email:</strong> ${email}
      </p>
    </div>

    <p>
      You can now log in to the Marhaba dashboard using your email address
      and the password provided when your account was created.
    </p>

    <div style="text-align: center; margin: 25px 0;">
      <a
        href="${loginUrl}/login"
        style="
          background-color: #1a1a2e;
          color: #e8c547;
          padding: 12px 24px;
          text-decoration: none;
          border-radius: 6px;
          display: inline-block;
        "
      >
        Open Marhaba Dashboard
      </a>
    </div>

    <p>
      For security reasons, please keep your password private.
    </p>

    <p>
      Best regards,<br>
      Marhaba Team
    </p>
  </div>

  <div style="border-top: 2px solid #e5e7eb; margin: 25px 0;"></div>

  <!-- Arabic -->
  <div style="direction: rtl; text-align: right;">

    <h2 style="color: #1a1a2e;">
      مرحباً بك في لوحة تحكم مرحبا
    </h2>

    <p>مرحباً ${name}،</p>

    <p>
      تم إنشاء حساب المسؤول الخاص بك في منصة مرحبا بنجاح.
    </p>

    <div style="
      background: #f7f6f2;
      padding: 20px;
      border-radius: 8px;
      margin: 20px 0;
    ">
      <p style="margin: 0 0 10px;">
        <strong>نوع الحساب:</strong> ${roleLabel}
      </p>

      <p style="margin: 0;">
        <strong>البريد الإلكتروني:</strong> ${email}
      </p>
    </div>

    <p>
      يمكنك الآن تسجيل الدخول إلى لوحة تحكم مرحبا باستخدام بريدك الإلكتروني
      وكلمة المرور التي تم استخدامها عند إنشاء الحساب.
    </p>

    <div style="text-align: center; margin: 25px 0;">
      <a
        href="${loginUrl}/login"
        style="
          background-color: #1a1a2e;
          color: #e8c547;
          padding: 12px 24px;
          text-decoration: none;
          border-radius: 6px;
          display: inline-block;
        "
      >
        فتح لوحة تحكم مرحبا
      </a>
    </div>

    <p>
      لأسباب أمنية، يرجى عدم مشاركة كلمة المرور الخاصة بك مع أي شخص.
    </p>

    <p>
      مع أطيب التحيات،<br>
      فريق مرحبا
    </p>

  </div>
</div>
`;

    return this.sendEmail({
      to: email,
      subject: "Marhaba Admin Account Created / تم إنشاء حساب مسؤول مرحبا",
      text: `
Welcome to Marhaba Admin.

Hello ${name},

Your ${roleLabel} account has been created successfully.

Email: ${email}

Login: ${loginUrl}/login

Best regards,
Marhaba Team
    `,
      html: emailHtml,
    });
  }

  /**
   * Send host confirmation email when a host account is confirmed
   * @param {Object} host - Host user object with name, email, etc.
   * @param {Date|string} expiryDate - The expiry date of the host status
   * @param {number} daysUntilExpiry - Number of days until expiry
   * @returns {Promise<Object>} Email send result
   */
  async sendHostConfirmationEmail(host, expiryDate, daysUntilExpiry) {
    const formattedExpiryDate = this.formatDateForEmail(expiryDate);
    const appUrl = process.env.NEXTAUTH_URL || process.env.BASE_URL || 'http://localhost:3000';
    
    const emailContent = {
      subject: `Welcome as a Host! / مرحباً بك كمضيف! - Marhaba`,
      text: `English: Congratulations! Your host account has been confirmed. Your hosting status is valid for 6 months until ${formattedExpiryDate}. You can now start listing your properties and accepting bookings.\n\nالعربية: تهانينا! تم تأكيد حسابك كمضيف. صلاحية حساب المضيف صالحة لمدة 6 أشهر حتى ${formattedExpiryDate}. يمكنك الآن البدء في إضافة عقاراتك واستقبال الحجوزات.`,
      html: `
<div style="font-family: Arial, 'Cairo', 'Tajawal', sans-serif; max-width: 600px; margin: auto; padding: 20px; background: #f7f6f2;">
  <div style="text-align: center; margin-bottom: 20px;">
    <h1 style="color: #1a1a2e;">مر<span style="color: #e8c547;">حبا</span></h1>
  </div>
  
  <!-- English Section -->
  <div style="margin-bottom: 30px;">
    <h2 style="color: #4F46E5;">🎉 Welcome as a Host!</h2>
    <p>Dear ${host.name},</p>
    <p><strong>Congratulations!</strong> Your host account has been <strong>confirmed</strong> by the Marhaba admin team.</p>
    <div style="background: #e0e7ff; padding: 20px; border-radius: 12px; margin: 20px 0;">
      <h3>✨ Host Account Details:</h3>
      <p><strong>📅 Expiry Date:</strong> ${formattedExpiryDate}</p>
      <p><strong>🔔 Days Remaining:</strong> ${daysUntilExpiry} days</p>
      <p style="margin-top: 10px; font-size: 14px; color: #4F46E5;">
        ⚠️ Please note: Your host status will expire after 6 months. You will need to renew your subscription to continue hosting.
      </p>
    </div>
    <a href="${appUrl}/host-dashboard" style="background-color: #4F46E5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block;">
      Go to Host Dashboard →
    </a>
    <p style="margin-top: 20px; font-size: 14px; color: #666;">
      You can now start listing your properties and accepting bookings. Make sure to complete your host profile for better visibility.
    </p>
  </div>
  
  <div style="border-top: 2px solid #e5e7eb; margin: 20px 0;"></div>
  
  <!-- Arabic Section -->
  <div style="direction: rtl; text-align: right;">
    <h2 style="color: #4F46E5;">🎉 مرحباً بك كمضيف!</h2>
    <p>عزيزي ${host.name}،</p>
    <p><strong>تهانينا!</strong> تم <strong>تأكيد</strong> حسابك كمضيف من قبل فريق إدارة مرحبا.</p>
    <div style="background: #e0e7ff; padding: 20px; border-radius: 12px; margin: 20px 0;">
      <h3>✨ تفاصيل حساب المضيف:</h3>
      <p><strong>📅 تاريخ الانتهاء:</strong> ${formattedExpiryDate}</p>
      <p><strong>🔔 الأيام المتبقية:</strong> ${daysUntilExpiry} يوم</p>
      <p style="margin-top: 10px; font-size: 14px; color: #4F46E5;">
        ⚠️ يرجى ملاحظة: صلاحية حساب المضيف تنتهي بعد 6 أشهر. ستحتاج إلى تجديد اشتراكك للاستمرار في الاستضافة.
      </p>
    </div>
    <a href="${appUrl}/host-dashboard" style="background-color: #4F46E5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block;">
      الذهاب إلى لوحة التحكم ←
    </a>
    <p style="margin-top: 20px; font-size: 14px; color: #666;">
      يمكنك الآن البدء في إضافة عقاراتك واستقبال الحجوزات. تأكد من إكمال ملف المضيف الخاص بك للحصول على رؤية أفضل.
    </p>
  </div>
</div>
      `
    };

    return this.sendEmail({
      to: host.email,
      subject: emailContent.subject,
      text: emailContent.text,
      html: emailContent.html,
    });
  }

  /**
   * Send host expiry reminder email
   * @param {Object} host - Host user object
   * @param {Date|string} expiryDate - The expiry date
   * @param {number} daysUntilExpiry - Number of days until expiry
   * @returns {Promise<Object>} Email send result
   */
  async sendHostExpiryReminderEmail(host, expiryDate, daysUntilExpiry) {
    const formattedExpiryDate = this.formatDateForEmail(expiryDate);
    const appUrl = process.env.NEXTAUTH_URL || process.env.BASE_URL || 'http://localhost:3000';
    
    const emailHtml = `
<div style="font-family: Arial, 'Cairo', 'Tajawal', sans-serif; max-width: 600px; margin: auto; padding: 20px; background: #f7f6f2;">
  <div style="text-align: center; margin-bottom: 20px;">
    <h1 style="color: #1a1a2e;">مر<span style="color: #e8c547;">حبا</span></h1>
  </div>
  
  <!-- English Section -->
  <div style="margin-bottom: 30px;">
    <h2 style="color: #E24B4A;">⚠️ Host Status Expiring Soon</h2>
    <p>Dear ${host.name},</p>
    <p>This is a friendly reminder that your host status will expire in <strong>${daysUntilExpiry} days</strong> on <strong>${formattedExpiryDate}</strong>.</p>
    <div style="background: #FCEBEB; padding: 20px; border-radius: 12px; margin: 20px 0; border: 1px solid #E24B4A;">
      <h3 style="color: #E24B4A;">⏰ Important:</h3>
      <p>To continue hosting and accepting bookings, please renew your subscription before the expiry date.</p>
      <p><strong>📅 Expiry Date:</strong> ${formattedExpiryDate}</p>
      <p><strong>🔔 Days Remaining:</strong> ${daysUntilExpiry} days</p>
    </div>
    <a href="${appUrl}/host-dashboard/subscription" style="background-color: #4F46E5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block;">
      Renew Subscription →
    </a>
  </div>
  
  <div style="border-top: 2px solid #e5e7eb; margin: 20px 0;"></div>
  
  <!-- Arabic Section -->
  <div style="direction: rtl; text-align: right;">
    <h2 style="color: #E24B4A;">⚠️ صلاحية حساب المضيف تنتهي قريباً</h2>
    <p>عزيزي ${host.name}،</p>
    <p>هذا تذكير ودود بأن صلاحية حساب المضيف الخاص بك ستنتهي خلال <strong>${daysUntilExpiry} يوم</strong> في <strong>${formattedExpiryDate}</strong>.</p>
    <div style="background: #FCEBEB; padding: 20px; border-radius: 12px; margin: 20px 0; border: 1px solid #E24B4A;">
      <h3 style="color: #E24B4A;">⏰ مهم:</h3>
      <p>لاستمرار الاستضافة وقبول الحجوزات، يرجى تجديد اشتراكك قبل تاريخ الانتهاء.</p>
      <p><strong>📅 تاريخ الانتهاء:</strong> ${formattedExpiryDate}</p>
      <p><strong>🔔 الأيام المتبقية:</strong> ${daysUntilExpiry} يوم</p>
    </div>
    <a href="${appUrl}/host-dashboard/subscription" style="background-color: #4F46E5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block;">
      تجديد الاشتراك ←
    </a>
  </div>
</div>
    `;

    return this.sendEmail({
      to: host.email,
      subject: `Host Status Expiring Soon / صلاحية حساب المضيف تنتهي قريباً - Marhaba`,
      text: `Dear ${host.name}, your host status will expire in ${daysUntilExpiry} days on ${formattedExpiryDate}. Please renew your subscription to continue hosting.`,
      html: emailHtml,
    });
  }

  /**
   * Send host subscription payment received confirmation
   * @param {Object} host - Host user object
   * @param {Object} payment - Payment object with amount, reference, etc.
   * @returns {Promise<Object>} Email send result
   */
  async sendHostPaymentReceivedEmail(host, payment) {
    const appUrl = process.env.NEXTAUTH_URL || process.env.BASE_URL || 'http://localhost:3000';
    const formattedDate = this.formatDateForEmail(payment.created_at);
    
    const emailHtml = `
<div style="font-family: Arial, 'Cairo', 'Tajawal', sans-serif; max-width: 600px; margin: auto; padding: 20px; background: #f7f6f2;">
  <div style="text-align: center; margin-bottom: 20px;">
    <h1 style="color: #1a1a2e;">مر<span style="color: #e8c547;">حبا</span></h1>
  </div>
  
  <!-- English Section -->
  <div style="margin-bottom: 30px;">
    <h2 style="color: #27500A;">✅ Payment Received</h2>
    <p>Dear ${host.name},</p>
    <p>We have received your subscription payment and it is now being reviewed by our team.</p>
    <div style="background: #EAF3DE; padding: 20px; border-radius: 12px; margin: 20px 0;">
      <h3>💳 Payment Details:</h3>
      <p><strong>Amount:</strong> LYD${payment.amount}</p>
      <p><strong>Reference:</strong> ${payment.reference || 'N/A'}</p>
      <p><strong>Date:</strong> ${formattedDate}</p>
      <p><strong>Status:</strong> ${payment.status}</p>
    </div>
    <p>We will review your payment and confirm your host status as soon as possible.</p>
    <a href="${appUrl}/host-dashboard" style="background-color: #4F46E5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block;">
      Go to Host Dashboard →
    </a>
  </div>
  
  <div style="border-top: 2px solid #e5e7eb; margin: 20px 0;"></div>
  
  <!-- Arabic Section -->
  <div style="direction: rtl; text-align: right;">
    <h2 style="color: #27500A;">✅ تم استلام الدفعة</h2>
    <p>عزيزي ${host.name}،</p>
    <p>لقد استلمنا دفعة اشتراكك وهي قيد المراجعة من قبل فريقنا.</p>
    <div style="background: #EAF3DE; padding: 20px; border-radius: 12px; margin: 20px 0;">
      <h3>💳 تفاصيل الدفعة:</h3>
      <p><strong>المبلغ:</strong> LYD${payment.amount}</p>
      <p><strong>المرجع:</strong> ${payment.reference || 'غير متوفر'}</p>
      <p><strong>التاريخ:</strong> ${formattedDate}</p>
      <p><strong>الحالة:</strong> ${payment.status}</p>
    </div>
    <p>سنقوم بمراجعة دفعتك وتأكيد حالة المضيف في أقرب وقت ممكن.</p>
    <a href="${appUrl}/host-dashboard" style="background-color: #4F46E5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block;">
      الذهاب إلى لوحة التحكم ←
    </a>
  </div>
</div>
    `;

    return this.sendEmail({
      to: host.email,
      subject: `Payment Received / تم استلام الدفعة - Marhaba`,
      text: `Dear ${host.name}, we have received your payment of LYD${payment.amount} and it is being reviewed.`,
      html: emailHtml,
    });
  }

  /**
   * Send host subscription payment approved confirmation
   * @param {Object} host - Host user object
   * @param {Object} payment - Payment object
   * @param {Date|string} expiryDate - New expiry date
   * @returns {Promise<Object>} Email send result
   */
  async sendHostPaymentApprovedEmail(host, payment, expiryDate) {
    const formattedExpiryDate = this.formatDateForEmail(expiryDate);
    const appUrl = process.env.NEXTAUTH_URL || process.env.BASE_URL || 'http://localhost:3000';
    
    const emailHtml = `
<div style="font-family: Arial, 'Cairo', 'Tajawal', sans-serif; max-width: 600px; margin: auto; padding: 20px; background: #f7f6f2;">
  <div style="text-align: center; margin-bottom: 20px;">
    <h1 style="color: #1a1a2e;">مر<span style="color: #e8c547;">حبا</span></h1>
  </div>
  
  <!-- English Section -->
  <div style="margin-bottom: 30px;">
    <h2 style="color: #27500A;">🎉 Payment Approved!</h2>
    <p>Dear ${host.name},</p>
    <p>Great news! Your subscription payment has been <strong>approved</strong> and your host status has been updated.</p>
    <div style="background: #EAF3DE; padding: 20px; border-radius: 12px; margin: 20px 0;">
      <h3>✨ Host Status Updated:</h3>
      <p><strong>📅 New Expiry Date:</strong> ${formattedExpiryDate}</p>
      <p><strong>💰 Payment Amount:</strong> LYD${payment.amount}</p>
      <p><strong>✅ Status:</strong> Approved</p>
    </div>
    <p>You can now continue hosting and accepting bookings.</p>
    <a href="${appUrl}/host-dashboard" style="background-color: #4F46E5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block;">
      Go to Host Dashboard →
    </a>
  </div>
  
  <div style="border-top: 2px solid #e5e7eb; margin: 20px 0;"></div>
  
  <!-- Arabic Section -->
  <div style="direction: rtl; text-align: right;">
    <h2 style="color: #27500A;">🎉 تم الموافقة على الدفعة!</h2>
    <p>عزيزي ${host.name}،</p>
    <p>أخبار رائعة! تمت <strong>الموافقة</strong> على دفعة اشتراكك وتم تحديث حالة المضيف الخاصة بك.</p>
    <div style="background: #EAF3DE; padding: 20px; border-radius: 12px; margin: 20px 0;">
      <h3>✨ تم تحديث حالة المضيف:</h3>
      <p><strong>📅 تاريخ الانتهاء الجديد:</strong> ${formattedExpiryDate}</p>
      <p><strong>💰 مبلغ الدفعة:</strong> LYD${payment.amount}</p>
      <p><strong>✅ الحالة:</strong> تمت الموافقة</p>
    </div>
    <p>يمكنك الآن الاستمرار في الاستضافة وقبول الحجوزات.</p>
    <a href="${appUrl}/host-dashboard" style="background-color: #4F46E5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block;">
      الذهاب إلى لوحة التحكم ←
    </a>
  </div>
</div>
    `;

    return this.sendEmail({
      to: host.email,
      subject: `Payment Approved / تمت الموافقة على الدفعة - Marhaba`,
      text: `Dear ${host.name}, your payment has been approved. Your host status is valid until ${formattedExpiryDate}.`,
      html: emailHtml,
    });
  }

  /**
   * Send host subscription payment rejected notification
   * @param {Object} host - Host user object
   * @param {Object} payment - Payment object
   * @param {string} reason - Rejection reason
   * @returns {Promise<Object>} Email send result
   */
  async sendHostPaymentRejectedEmail(host, payment, reason) {
    const appUrl = process.env.NEXTAUTH_URL || process.env.BASE_URL || 'http://localhost:3000';
    
    const emailHtml = `
<div style="font-family: Arial, 'Cairo', 'Tajawal', sans-serif; max-width: 600px; margin: auto; padding: 20px; background: #f7f6f2;">
  <div style="text-align: center; margin-bottom: 20px;">
    <h1 style="color: #1a1a2e;">مر<span style="color: #e8c547;">حبا</span></h1>
  </div>
  
  <!-- English Section -->
  <div style="margin-bottom: 30px;">
    <h2 style="color: #E24B4A;">❌ Payment Rejected</h2>
    <p>Dear ${host.name},</p>
    <p>We regret to inform you that your subscription payment has been <strong>rejected</strong>.</p>
    <div style="background: #FCEBEB; padding: 20px; border-radius: 12px; margin: 20px 0; border: 1px solid #E24B4A;">
      <h3 style="color: #E24B4A;">📋 Details:</h3>
      <p><strong>Amount:</strong> LYD${payment.amount}</p>
      <p><strong>Status:</strong> Rejected</p>
      ${reason ? `<p><strong>Reason:</strong> ${reason}</p>` : ''}
    </div>
    <p>Please upload a new payment receipt or contact our support team for assistance.</p>
    <a href="${appUrl}/host-dashboard/subscription" style="background-color: #4F46E5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block;">
      Submit New Payment →
    </a>
  </div>
  
  <div style="border-top: 2px solid #e5e7eb; margin: 20px 0;"></div>
  
  <!-- Arabic Section -->
  <div style="direction: rtl; text-align: right;">
    <h2 style="color: #E24B4A;">❌ تم رفض الدفعة</h2>
    <p>عزيزي ${host.name}،</p>
    <p>نأسف لإبلاغك بأن دفعة اشتراكك قد تم <strong>رفضها</strong>.</p>
    <div style="background: #FCEBEB; padding: 20px; border-radius: 12px; margin: 20px 0; border: 1px solid #E24B4A;">
      <h3 style="color: #E24B4A;">📋 التفاصيل:</h3>
      <p><strong>المبلغ:</strong> LYD${payment.amount}</p>
      <p><strong>الحالة:</strong> مرفوضة</p>
      ${reason ? `<p><strong>السبب:</strong> ${reason}</p>` : ''}
    </div>
    <p>يرجى تحميل إيصال دفع جديد أو الاتصال بفريق الدعم للحصول على المساعدة.</p>
    <a href="${appUrl}/host-dashboard/subscription" style="background-color: #4F46E5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block;">
      تقديم دفعة جديدة ←
    </a>
  </div>
</div>
    `;

    return this.sendEmail({
      to: host.email,
      subject: `Payment Rejected / تم رفض الدفعة - Marhaba`,
      text: `Dear ${host.name}, your payment has been rejected. ${reason ? `Reason: ${reason}` : ''}`,
      html: emailHtml,
    });
  }
}

module.exports = new EmailService();