const nodemailer = require("nodemailer");
console.log("🔧 EmailService file loaded");

class EmailService {
  constructor() {
    // Use the same configuration that works in Next.js
    this.host = process.env.EMAIL_HOST || "65.109.38.16";
    this.port = parseInt(process.env.EMAIL_PORT) || 465;
    this.secure = process.env.EMAIL_SECURE === "true" || true;
    this.user = process.env.EMAIL_USER;
    this.pass = process.env.EMAIL_PASS;
    this.from = process.env.EMAIL_FROM || process.env.EMAIL_USER;

    console.log("📧 Email Configuration:");
    console.log("  Host:", this.host);
    console.log("  Port:", this.port);
    console.log("  Secure:", this.secure);
    console.log("  User:", this.user ? "SET" : "NOT SET");
    console.log("  Pass:", this.pass ? "SET" : "NOT SET");
  }

  async sendEmail({ to, subject, text, html }) {
    if (!this.user || !this.pass) {
      console.error("❌ Email configuration missing");
      return {
        success: false,
        error: "Email configuration missing",
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
          servername: "mail.mar-haba.ly", // Important for SSL
        },
        // Timeouts
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 10000,
      });

      // Verify connection
      await transporter.verify();
      console.log("✅ SMTP connection verified");

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
      console.error("❌ Email error:", error.message);
      if (error.code) console.error("  Code:", error.code);
      if (error.command) console.error("  Command:", error.command);
      return {
        success: false,
        error: error.message,
        code: error.code,
      };
    }
  }

  // Helper function to format date for email
  formatDateForEmail(date) {
    if (!date) return "N/A";
    const d = new Date(date);
    return d.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  }

  // ============================================================
  // USER VERIFICATION EMAILS
  // ============================================================

  async sendVerificationEmail(email, name, token) {
    const frontendUrl = process.env.BASE_URL || "http://localhost:5173";
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
      subject:
        "Welcome to Marhaba! Please verify your email / مرحباً بك في مرحبا! يرجى تأكيد بريدك الإلكتروني",
      text: `Welcome to Marhaba! Please verify your email by clicking this link: ${verificationUrl}`,
      html: emailHtml,
    });
  }

  async sendAdminWelcomeEmail(email, name, role) {
    const loginUrl =
      process.env.DASHBOARD_URL || "https://dashboard.dmar-haba.ly";

    const roleLabel =
      role === "super_admin" ? "Super Administrator" : "Administrator";

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

  // ============================================================
  // HOST VERIFICATION EMAILS
  // ============================================================

  /**
   * Send ID verification approval email
   */
  async sendIDApprovalEmail(email, name) {
    const emailHtml = `
<div style="font-family: Arial, 'Cairo', 'Tajawal', sans-serif; max-width: 600px; margin: auto; padding: 20px; background: #f7f6f2;">
  <div style="text-align: center; margin-bottom: 20px;">
    <h1 style="color: #1a1a2e;">مر<span style="color: #e8c547;">حبا</span></h1>
  </div>
  
  <!-- English Section -->
  <div style="margin-bottom: 30px;">
    <h2 style="color: #27500A;">✅ ID Verified Successfully</h2>
    <p>Dear ${name},</p>
    <p>Your ID has been <strong>verified</strong> successfully!</p>
    <div style="background: #EAF3DE; padding: 20px; border-radius: 12px; margin: 20px 0;">
      <h3>📋 Status Update:</h3>
      <p>Your identity has been confirmed. Please upload your payment receipt to complete the host registration.</p>
    </div>
    <p>You can now upload your payment receipt from your host dashboard.</p>
  </div>
  
  <div style="border-top: 2px solid #e5e7eb; margin: 20px 0;"></div>
  
  <!-- Arabic Section -->
  <div style="direction: rtl; text-align: right;">
    <h2 style="color: #27500A;">✅ تم التحقق من الهوية بنجاح</h2>
    <p>عزيزي ${name}،</p>
    <p>تم <strong>التحقق</strong> من هويتك بنجاح!</p>
    <div style="background: #EAF3DE; padding: 20px; border-radius: 12px; margin: 20px 0;">
      <h3>📋 تحديث الحالة:</h3>
      <p>تم تأكيد هويتك. يرجى تحميل إيصال الدفع لإكمال تسجيل المضيف.</p>
    </div>
    <p>يمكنك الآن تحميل إيصال الدفع من لوحة تحكم المضيف الخاصة بك.</p>
  </div>
</div>
    `;

    return this.sendEmail({
      to: email,
      subject: `ID Verified / تم التحقق من الهوية - Marhaba`,
      text: `Dear ${name}, your ID has been verified successfully. Please upload your payment receipt to complete registration.`,
      html: emailHtml,
    });
  }

  /**
   * Send ID verification rejection email
   */
  async sendIDRejectionEmail(email, name, reason) {
    const emailHtml = `
<div style="font-family: Arial, 'Cairo', 'Tajawal', sans-serif; max-width: 600px; margin: auto; padding: 20px; background: #f7f6f2;">
  <div style="text-align: center; margin-bottom: 20px;">
    <h1 style="color: #1a1a2e;">مر<span style="color: #e8c547;">حبا</span></h1>
  </div>
  
  <!-- English Section -->
  <div style="margin-bottom: 30px;">
    <h2 style="color: #E24B4A;">❌ ID Verification Rejected</h2>
    <p>Dear ${name},</p>
    <p>We regret to inform you that your ID verification has been <strong>rejected</strong>.</p>
    <div style="background: #FCEBEB; padding: 20px; border-radius: 12px; margin: 20px 0; border: 1px solid #E24B4A;">
      <h3 style="color: #E24B4A;">📋 Reason:</h3>
      <p>${reason || "The ID document was unclear or invalid"}</p>
    </div>
    <p>Please upload a new, clear copy of your official ID document.</p>
  </div>
  
  <div style="border-top: 2px solid #e5e7eb; margin: 20px 0;"></div>
  
  <!-- Arabic Section -->
  <div style="direction: rtl; text-align: right;">
    <h2 style="color: #E24B4A;">❌ تم رفض التحقق من الهوية</h2>
    <p>عزيزي ${name}،</p>
    <p>نأسف لإبلاغك بأن التحقق من هويتك قد تم <strong>رفضه</strong>.</p>
    <div style="background: #FCEBEB; padding: 20px; border-radius: 12px; margin: 20px 0; border: 1px solid #E24B4A;">
      <h3 style="color: #E24B4A;">📋 السبب:</h3>
      <p>${reason || "وثيقة الهوية غير واضحة أو غير صالحة"}</p>
    </div>
    <p>يرجى تحميل نسخة جديدة وواضحة من وثيقة هويتك الرسمية.</p>
  </div>
</div>
    `;

    return this.sendEmail({
      to: email,
      subject: `ID Verification Rejected / تم رفض التحقق من الهوية - Marhaba`,
      text: `Dear ${name}, your ID verification has been rejected. Reason: ${reason || "The ID document was unclear or invalid"}`,
      html: emailHtml,
    });
  }

  /**
   * Send payment approval email
   */
  async sendPaymentApprovalEmail(email, name) {
    const appUrl = process.env.BASE_URL || "https://mar-haba.ly";

    const emailHtml = `
<div style="font-family: Arial, 'Cairo', 'Tajawal', sans-serif; max-width: 600px; margin: auto; padding: 20px; background: #f7f6f2;">
  <div style="text-align: center; margin-bottom: 20px;">
    <h1 style="color: #1a1a2e;">مر<span style="color: #e8c547;">حبا</span></h1>
  </div>
  
  <!-- English Section -->
  <div style="margin-bottom: 30px;">
    <h2 style="color: #27500A;">✅ Payment Approved!</h2>
    <p>Dear ${name},</p>
    <p>Your payment has been <strong>approved</strong>!</p>
    <div style="background: #EAF3DE; padding: 20px; border-radius: 12px; margin: 20px 0;">
      <h3>🎉 What's next?</h3>
      <p>Your host account is now being finalized. You will receive a confirmation email once your host status is activated.</p>
      <p>This usually takes 24-48 hours.</p>
    </div>
    <a href="${appUrl}/host-dashboard" style="background-color: #4F46E5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block;">
      Go to Host Dashboard →
    </a>
  </div>
  
  <div style="border-top: 2px solid #e5e7eb; margin: 20px 0;"></div>
  
  <!-- Arabic Section -->
  <div style="direction: rtl; text-align: right;">
    <h2 style="color: #27500A;">✅ تم الموافقة على الدفع!</h2>
    <p>عزيزي ${name}،</p>
    <p>تمت <strong>الموافقة</strong> على دفعتك!</p>
    <div style="background: #EAF3DE; padding: 20px; border-radius: 12px; margin: 20px 0;">
      <h3>🎉 ما التالي؟</h3>
      <p>يتم الآن إنهاء حساب المضيف الخاص بك. ستتلقى رسالة تأكيد عبر البريد الإلكتروني بمجرد تفعيل حالة المضيف.</p>
      <p>عادة ما تستغرق هذه العملية 24-48 ساعة.</p>
    </div>
    <a href="${appUrl}/host-dashboard" style="background-color: #4F46E5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block;">
      الذهاب إلى لوحة التحكم ←
    </a>
  </div>
</div>
    `;

    return this.sendEmail({
      to: email,
      subject: `Payment Approved / تمت الموافقة على الدفع - Marhaba`,
      text: `Dear ${name}, your payment has been approved.`,
      html: emailHtml,
    });
  }

  /**
   * Send payment rejection email
   */
  async sendPaymentRejectionEmail(email, name, reason) {
    const appUrl = process.env.BASE_URL || "https://mar-haba.ly";

    const emailHtml = `
<div style="font-family: Arial, 'Cairo', 'Tajawal', sans-serif; max-width: 600px; margin: auto; padding: 20px; background: #f7f6f2;">
  <div style="text-align: center; margin-bottom: 20px;">
    <h1 style="color: #1a1a2e;">مر<span style="color: #e8c547;">حبا</span></h1>
  </div>
  
  <!-- English Section -->
  <div style="margin-bottom: 30px;">
    <h2 style="color: #E24B4A;">❌ Payment Receipt Rejected</h2>
    <p>Dear ${name},</p>
    <p>We regret to inform you that your payment receipt has been <strong>rejected</strong>.</p>
    <div style="background: #FCEBEB; padding: 20px; border-radius: 12px; margin: 20px 0; border: 1px solid #E24B4A;">
      <h3 style="color: #E24B4A;">📋 Reason:</h3>
      <p>${reason || "The receipt was unclear or invalid"}</p>
    </div>
    <p>Please upload a new, clear payment receipt.</p>
    <a href="${appUrl}/host-dashboard" style="background-color: #4F46E5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block;">
      Upload New Receipt →
    </a>
  </div>
  
  <div style="border-top: 2px solid #e5e7eb; margin: 20px 0;"></div>
  
  <!-- Arabic Section -->
  <div style="direction: rtl; text-align: right;">
    <h2 style="color: #E24B4A;">❌ تم رفض إيصال الدفع</h2>
    <p>عزيزي ${name}،</p>
    <p>نأسف لإبلاغك بأن إيصال الدفع الخاص بك قد تم <strong>رفضه</strong>.</p>
    <div style="background: #FCEBEB; padding: 20px; border-radius: 12px; margin: 20px 0; border: 1px solid #E24B4A;">
      <h3 style="color: #E24B4A;">📋 السبب:</h3>
      <p>${reason || "الإيصال غير واضح أو غير صالح"}</p>
    </div>
    <p>يرجى تحميل إيصال دفع جديد وواضح.</p>
    <a href="${appUrl}/host-dashboard" style="background-color: #4F46E5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block;">
      تحميل إيصال جديد ←
    </a>
  </div>
</div>
    `;

    return this.sendEmail({
      to: email,
      subject: `Payment Rejected / تم رفض الدفع - Marhaba`,
      text: `Dear ${name}, your payment receipt has been rejected. Reason: ${reason || "The receipt was unclear or invalid"}`,
      html: emailHtml,
    });
  }

  /**
   * Send host pending approval notification (when host submits application)
   */
  async sendHostPendingApprovalEmail(host, adminEmails = []) {
    const appUrl = process.env.BASE_URL || "https://mar-haba.ly";
    const dashboardUrl =
      process.env.DASHBOARD_URL || "https://dashboard.mar-haba.ly";

    // Send to host
    const hostEmailHtml = `
<div style="font-family: Arial, 'Cairo', 'Tajawal', sans-serif; max-width: 600px; margin: auto; padding: 20px; background: #f7f6f2;">
  <div style="text-align: center; margin-bottom: 20px;">
    <h1 style="color: #1a1a2e;">مر<span style="color: #e8c547;">حبا</span></h1>
  </div>
  
  <!-- English Section -->
  <div style="margin-bottom: 30px;">
    <h2 style="color: #F59E0B;">⏳ Application Received</h2>
    <p>Dear ${host.name},</p>
    <p>Thank you for applying to become a host on Marhaba!</p>
    <div style="background: #FEF3C7; padding: 20px; border-radius: 12px; margin: 20px 0; border: 1px solid #F59E0B;">
      <h3 style="color: #F59E0B;">📋 Application Status:</h3>
      <p><strong>Status:</strong> Pending Review</p>
      <p>Your application is currently being reviewed by our admin team.</p>
    </div>
    <p>We will notify you as soon as your application is approved.</p>
    <p>This process typically takes 24-48 hours.</p>
  </div>
  
  <div style="border-top: 2px solid #e5e7eb; margin: 20px 0;"></div>
  
  <!-- Arabic Section -->
  <div style="direction: rtl; text-align: right;">
    <h2 style="color: #F59E0B;">⏳ تم استلام الطلب</h2>
    <p>عزيزي ${host.name}،</p>
    <p>شكراً لتقديمك طلباً لتصبح مضيفاً على مرحبا!</p>
    <div style="background: #FEF3C7; padding: 20px; border-radius: 12px; margin: 20px 0; border: 1px solid #F59E0B;">
      <h3 style="color: #F59E0B;">📋 حالة الطلب:</h3>
      <p><strong>الحالة:</strong> قيد المراجعة</p>
      <p>طلبك قيد المراجعة من قبل فريق الإدارة.</p>
    </div>
    <p>سنخطرك بمجرد الموافقة على طلبك.</p>
    <p>عادة ما تستغرق هذه العملية 24-48 ساعة.</p>
  </div>
</div>
    `;

    // Send to host
    await this.sendEmail({
      to: host.email,
      subject: `Host Application Received / تم استلام طلب المضيف - Marhaba`,
      text: `Dear ${host.name}, your host application has been received and is pending review.`,
      html: hostEmailHtml,
    });

    // Send to admins (if admin emails provided)
    if (adminEmails && adminEmails.length > 0) {
      const adminEmailHtml = `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px;">
  <h2 style="color: #4F46E5;">📋 New Host Application</h2>
  <p>A new host application requires your review.</p>
  <div style="background: #f3f4f6; padding: 20px; border-radius: 8px; margin: 20px 0;">
    <p><strong>Name:</strong> ${host.name}</p>
    <p><strong>Email:</strong> ${host.email}</p>
    <p><strong>Phone:</strong> ${host.phone_number || "N/A"}</p>
    <p><strong>Applied:</strong> ${new Date(host.created_at).toLocaleString()}</p>
  </div>
  <a href="${dashboardUrl}/admin/users/${host.id}" style="background-color: #4F46E5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block;">
    Review Application →
  </a>
</div>
      `;

      // Send to each admin
      for (const adminEmail of adminEmails) {
        await this.sendEmail({
          to: adminEmail,
          subject: `New Host Application / طلب مضيف جديد - Marhaba`,
          text: `New host application from ${host.name} (${host.email}) requires review.`,
          html: adminEmailHtml,
        });
      }
    }

    return { success: true };
  }

  /**
   * Send host confirmation email when a host account is confirmed
   */
  async sendHostConfirmationEmail(host, expiryDate, daysUntilExpiry) {
    const formattedExpiryDate = this.formatDateForEmail(expiryDate);
    const appUrl = process.env.BASE_URL || "https://mar-haba.ly";

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
      `,
    };

    return this.sendEmail({
      to: host.email,
      subject: emailContent.subject,
      text: emailContent.text,
      html: emailContent.html,
    });
  }

  /**
   * Send host suspension notification email
   */
  async sendHostSuspensionEmail(email, name, reason) {
    const appUrl = process.env.BASE_URL || "https://mar-haba.ly";

    const emailHtml = `
<div style="font-family: Arial, 'Cairo', 'Tajawal', sans-serif; max-width: 600px; margin: auto; padding: 20px; background: #f7f6f2;">
  <div style="text-align: center; margin-bottom: 20px;">
    <h1 style="color: #1a1a2e;">مر<span style="color: #e8c547;">حبا</span></h1>
  </div>
  
  <!-- English Section -->
  <div style="margin-bottom: 30px;">
    <h2 style="color: #E24B4A;">🚫 Account Suspended</h2>
    <p>Dear ${name},</p>
    <p>We regret to inform you that your host account has been <strong>suspended</strong>.</p>
    <div style="background: #FCEBEB; padding: 20px; border-radius: 12px; margin: 20px 0; border: 1px solid #E24B4A;">
      <h3 style="color: #E24B4A;">📋 Reason:</h3>
      <p>${reason || "Violation of terms of service"}</p>
    </div>
    <p>Your properties are no longer visible to guests, and you cannot accept new bookings.</p>
    <p>If you believe this is a mistake, please contact our support team.</p>
    <a href="${appUrl}/contact" style="background-color: #4F46E5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block;">
      Contact Support →
    </a>
  </div>
  
  <div style="border-top: 2px solid #e5e7eb; margin: 20px 0;"></div>
  
  <!-- Arabic Section -->
  <div style="direction: rtl; text-align: right;">
    <h2 style="color: #E24B4A;">🚫 تم تعليق الحساب</h2>
    <p>عزيزي ${name}،</p>
    <p>نأسف لإبلاغك بأن حساب المضيف الخاص بك قد تم <strong>تعليقه</strong>.</p>
    <div style="background: #FCEBEB; padding: 20px; border-radius: 12px; margin: 20px 0; border: 1px solid #E24B4A;">
      <h3 style="color: #E24B4A;">📋 السبب:</h3>
      <p>${reason || "انتهاك شروط الخدمة"}</p>
    </div>
    <p>لم تعد عقاراتك مرئية للضيوف، ولا يمكنك قبول حجوزات جديدة.</p>
    <p>إذا كنت تعتقد أن هذا خطأ، يرجى الاتصال بفريق الدعم.</p>
    <a href="${appUrl}/contact" style="background-color: #4F46E5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block;">
      اتصل بالدعم ←
    </a>
  </div>
</div>
    `;

    return this.sendEmail({
      to: email,
      subject: `Account Suspended / تم تعليق الحساب - Marhaba`,
      text: `Dear ${name}, your host account has been suspended. Reason: ${reason || "Violation of terms of service"}`,
      html: emailHtml,
    });
  }

  /**
   * Send host account reactivation notification
   */
  async sendHostReactivationEmail(host, reason = "") {
    const appUrl = process.env.BASE_URL || "https://mar-haba.ly";

    const emailHtml = `
<div style="font-family: Arial, 'Cairo', 'Tajawal', sans-serif; max-width: 600px; margin: auto; padding: 20px; background: #f7f6f2;">
  <div style="text-align: center; margin-bottom: 20px;">
    <h1 style="color: #1a1a2e;">مر<span style="color: #e8c547;">حبا</span></h1>
  </div>
  
  <!-- English Section -->
  <div style="margin-bottom: 30px;">
    <h2 style="color: #27500A;">✅ Account Reactivated</h2>
    <p>Dear ${host.name},</p>
    <p>We are pleased to inform you that your host account has been <strong>reactivated</strong>.</p>
    <div style="background: #EAF3DE; padding: 20px; border-radius: 12px; margin: 20px 0;">
      <h3>📋 Status Update:</h3>
      <p>Your account is now active again.</p>
      ${reason ? `<p><strong>Note:</strong> ${reason}</p>` : ""}
    </div>
    <p>Your properties are now visible to guests, and you can accept new bookings.</p>
    <a href="${appUrl}/host-dashboard" style="background-color: #4F46E5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block;">
      Go to Host Dashboard →
    </a>
  </div>
  
  <div style="border-top: 2px solid #e5e7eb; margin: 20px 0;"></div>
  
  <!-- Arabic Section -->
  <div style="direction: rtl; text-align: right;">
    <h2 style="color: #27500A;">✅ تم إعادة تنشيط الحساب</h2>
    <p>عزيزي ${host.name}،</p>
    <p>يسرنا إبلاغك بأن حساب المضيف الخاص بك قد تم <strong>إعادة تنشيطه</strong>.</p>
    <div style="background: #EAF3DE; padding: 20px; border-radius: 12px; margin: 20px 0;">
      <h3>📋 تحديث الحالة:</h3>
      <p>حسابك نشط الآن مرة أخرى.</p>
      ${reason ? `<p><strong>ملاحظة:</strong> ${reason}</p>` : ""}
    </div>
    <p>أصبحت عقاراتك مرئية للضيوف، ويمكنك قبول حجوزات جديدة.</p>
    <a href="${appUrl}/host-dashboard" style="background-color: #4F46E5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block;">
      الذهاب إلى لوحة التحكم ←
    </a>
  </div>
</div>
    `;

    return this.sendEmail({
      to: host.email,
      subject: `Account Reactivated / تم إعادة تنشيط الحساب - Marhaba`,
      text: `Dear ${host.name}, your host account has been reactivated.`,
      html: emailHtml,
    });
  }

  // ============================================================
  // SUBSCRIPTION & PAYMENT EMAILS
  // ============================================================

  /**
   * Send host subscription payment received confirmation
   */
  async sendHostPaymentReceivedEmail(host, payment) {
    const appUrl = process.env.BASE_URL || "https://mar-haba.ly";
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
      <p><strong>Reference:</strong> ${payment.reference || "N/A"}</p>
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
      <p><strong>المرجع:</strong> ${payment.reference || "غير متوفر"}</p>
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
   */
  async sendHostPaymentApprovedEmail(host, payment, expiryDate) {
    const formattedExpiryDate = this.formatDateForEmail(expiryDate);
    const appUrl = process.env.BASE_URL || "https://mar-haba.ly";

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
   */
  async sendHostPaymentRejectedEmail(host, payment, reason) {
    const appUrl = process.env.BASE_URL || "https://mar-haba.ly";

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
      ${reason ? `<p><strong>Reason:</strong> ${reason}</p>` : ""}
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
      ${reason ? `<p><strong>السبب:</strong> ${reason}</p>` : ""}
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
      text: `Dear ${host.name}, your payment has been rejected. ${reason ? `Reason: ${reason}` : ""}`,
      html: emailHtml,
    });
  }

  /**
   * Send host expiry reminder email
   */
  async sendHostExpiryReminderEmail(host, expiryDate, daysUntilExpiry) {
    const formattedExpiryDate = this.formatDateForEmail(expiryDate);
    const appUrl = process.env.BASE_URL || "https://mar-haba.ly";

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
   * Send notification to admin about new host application
   */
  async sendAdminNewHostNotification(host, adminEmail) {
    const dashboardUrl =
      process.env.DASHBOARD_URL || "https://dashboard.mar-haba.ly";

    const emailHtml = `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px;">
  <h2 style="color: #4F46E5;">📋 New Host Application</h2>
  <p>A new host application requires your review.</p>
  <div style="background: #f3f4f6; padding: 20px; border-radius: 8px; margin: 20px 0;">
    <p><strong>Name:</strong> ${host.name}</p>
    <p><strong>Email:</strong> ${host.email}</p>
    <p><strong>Phone:</strong> ${host.phone_number || "N/A"}</p>
    <p><strong>Applied:</strong> ${new Date(host.created_at).toLocaleString()}</p>
  </div>
  <a href="${dashboardUrl}/admin/users/${host.id}" style="background-color: #4F46E5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block;">
    Review Application →
  </a>
</div>
    `;

    return this.sendEmail({
      to: adminEmail,
      subject: `New Host Application / طلب مضيف جديد - Marhaba`,
      text: `New host application from ${host.name} (${host.email}) requires review.`,
      html: emailHtml,
    });
  }

  /**
   * Send notification tp pending application
   */

  async sendHostPendingApproval(host, adminEmails = []) {
    // Send to host
    const hostEmailHtml = `
<div style="font-family: Arial, 'Cairo', 'Tajawal', sans-serif; max-width: 600px; margin: auto; padding: 20px; background: #f7f6f2;">
  <div style="text-align: center; margin-bottom: 20px;">
    <h1 style="color: #1a1a2e;">
      مر<span style="color: #e8c547;">حبا</span>
    </h1>
  </div>

  <!-- English Section -->
  <div style="margin-bottom: 30px;">
    <h2 style="color: #F59E0B;">⏳ Account Under Review</h2>

    <p>Dear ${host.name},</p>

    <p>
      Thank you for applying to become a host on Marhaba.
    </p>

    <div style="background: #FEF3C7; padding: 20px; border-radius: 12px; margin: 20px 0; border: 1px solid #F59E0B;">
      <h3 style="color: #F59E0B; margin-top: 0;">
        📋 Account Status
      </h3>

      <p>
        <strong>Status:</strong> Under Review
      </p>

      <p>
        Your host application has been received and is currently under review by our administration team.
      </p>

      <p>
        Your account will remain under review until the verification process is completed.
      </p>
    </div>

    <p>
      We will notify you by email once the review is completed and your host account has been approved or rejected.
    </p>

    <p>
      Thank you for your patience.
    </p>

    <p>
      <strong>Registered email:</strong> ${host.email}
    </p>
  </div>

  <div style="border-top: 2px solid #e5e7eb; margin: 20px 0;"></div>

  <!-- Arabic Section -->
  <div style="direction: rtl; text-align: right;">
    <h2 style="color: #F59E0B;">⏳ الحساب قيد المراجعة</h2>

    <p>عزيزي ${host.name}،</p>

    <p>
      شكراً لتقديمك طلباً لتصبح مضيفاً على مرحبا.
    </p>

    <div style="background: #FEF3C7; padding: 20px; border-radius: 12px; margin: 20px 0; border: 1px solid #F59E0B;">
      <h3 style="color: #F59E0B; margin-top: 0;">
        📋 حالة الحساب
      </h3>

      <p>
        <strong>الحالة:</strong> قيد المراجعة
      </p>

      <p>
        تم استلام طلبك لاستضافة العقارات، وهو حالياً قيد المراجعة من قبل فريق الإدارة.
      </p>

      <p>
        سيظل حسابك قيد المراجعة حتى اكتمال عملية التحقق.
      </p>
    </div>

    <p>
      سنقوم بإرسال إشعار إليك عبر البريد الإلكتروني بمجرد الانتهاء من المراجعة والموافقة على حساب المضيف أو رفضه.
    </p>

    <p>
      شكراً لصبرك وتفهمك.
    </p>

    <p>
      <strong>البريد الإلكتروني المسجل:</strong> ${host.email}
    </p>
  </div>
</div>
  `;

    const hostEmailText = `
Dear ${host.name},

Thank you for applying to become a host on Marhaba.

Your host application has been received and is currently under review by our administration team.

Status: Under Review

Your account will remain under review until the verification process is completed.

We will notify you by email once the review is completed and your host account has been approved or rejected.

Registered email: ${host.email}

Thank you for your patience.

---

عزيزي ${host.name}،

شكراً لتقديمك طلباً لتصبح مضيفاً على مرحبا.

تم استلام طلبك، وهو حالياً قيد المراجعة من قبل فريق الإدارة.

الحالة: قيد المراجعة

سيظل حسابك قيد المراجعة حتى اكتمال عملية التحقق.

سنقوم بإرسال إشعار إليك عبر البريد الإلكتروني بمجرد الانتهاء من المراجعة والموافقة على حساب المضيف أو رفضه.

البريد الإلكتروني المسجل: ${host.email}

شكراً لصبرك وتفهمك.
  `;

    // Send to host
    await this.sendEmail({
      to: host.email,
      subject: `Account Under Review / الحساب قيد المراجعة - Marhaba`,
      text: hostEmailText,
      html: hostEmailHtml,
    });

    // Send notification to admins
    if (adminEmails && adminEmails.length > 0) {
      const adminEmailHtml = `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px;">
  <h2 style="color: #F59E0B;">⏳ Host Account Under Review</h2>

  <p>
    A new host application is currently under review.
  </p>

  <div style="background: #f3f4f6; padding: 20px; border-radius: 8px; margin: 20px 0;">
    <p><strong>Name:</strong> ${host.name}</p>
    <p><strong>Email:</strong> ${host.email}</p>
    <p><strong>Phone:</strong> ${host.phone_number || "N/A"}</p>
    <p><strong>Status:</strong> Under Review</p>
    <p><strong>Applied:</strong> ${new Date(host.created_at).toLocaleString()}</p>
  </div>

  <p>
    Please review the host application and update the account status through the administration system.
  </p>
</div>
    `;

      const adminEmailText = `
A new host application is currently under review.

Name: ${host.name}
Email: ${host.email}
Phone: ${host.phone_number || "N/A"}
Status: Under Review
Applied: ${new Date(host.created_at).toLocaleString()}

Please review the host application and update the account status through the administration system.
    `;

      for (const adminEmail of adminEmails) {
        await this.sendEmail({
          to: adminEmail,
          subject: `Host Account Under Review / حساب مضيف قيد المراجعة - Marhaba`,
          text: adminEmailText,
          html: adminEmailHtml,
        });
      }
    }

    return { success: true };
  }

  /**
   * Send host ID approval email
   */
  async sendHostIdDocumentApprovedEmail(host) {
    const appUrl = process.env.BASE_URL || "https://mar-haba.ly";

    const emailHtml = `
<div style="
  font-family: Arial, 'Cairo', 'Tajawal', sans-serif;
  max-width: 600px;
  margin: auto;
  padding: 20px;
  background: #f7f6f2;
">

  <div style="text-align: center; margin-bottom: 20px;">
    <h1 style="color: #1a1a2e;">
      مر<span style="color: #e8c547;">حبا</span>
    </h1>
  </div>

  <!-- English Section -->
  <div style="margin-bottom: 30px;">

    <h2 style="color: #27500A;">
      ✅ ID Verification Approved
    </h2>

    <p>Dear ${host.name},</p>

    <p>
      Great news! Your identity document has been
      <strong>approved and verified</strong> by the Marhaba administration team.
    </p>

    <div style="
      background: #EAF3DE;
      padding: 20px;
      border-radius: 12px;
      margin: 20px 0;
      border: 1px solid #27500A;
    ">

      <h3 style="color: #27500A; margin-top: 0;">
        📋 ID Verification Status
      </h3>

      <p>
        <strong>Status:</strong>
        <span style="color: #27500A;">Approved</span>
      </p>

      <p>
        Your identity has been successfully verified.
      </p>

    </div>

    <p>
      You can now continue with the next step of your host registration.
    </p>

    <p>
      Please upload your payment receipt from your host dashboard to continue.
    </p>

    <div style="text-align: center; margin: 25px 0;">
      <a
        href="${appUrl}/host-dashboard"
        style="
          background-color: #4F46E5;
          color: white;
          padding: 12px 24px;
          text-decoration: none;
          border-radius: 6px;
          display: inline-block;
        "
      >
        Go to Host Dashboard →
      </a>
    </div>

    <p>
      Thank you for choosing Marhaba.
    </p>

    <p>
      Best regards,<br>
      Marhaba Team
    </p>

  </div>

  <div style="border-top: 2px solid #e5e7eb; margin: 25px 0;"></div>

  <!-- Arabic Section -->
  <div style="direction: rtl; text-align: right;">

    <h2 style="color: #27500A;">
      ✅ تمت الموافقة على التحقق من الهوية
    </h2>

    <p>عزيزي ${host.name}،</p>

    <p>
      أخبار رائعة! تمت
      <strong>الموافقة والتحقق من وثيقة هويتك</strong>
      من قبل فريق إدارة مرحبا.
    </p>

    <div style="
      background: #EAF3DE;
      padding: 20px;
      border-radius: 12px;
      margin: 20px 0;
      border: 1px solid #27500A;
    ">

      <h3 style="color: #27500A; margin-top: 0;">
        📋 حالة التحقق من الهوية
      </h3>

      <p>
        <strong>الحالة:</strong>
        <span style="color: #27500A;">تمت الموافقة</span>
      </p>

      <p>
        تم التحقق من هويتك بنجاح.
      </p>

    </div>

    <p>
      يمكنك الآن الانتقال إلى الخطوة التالية من تسجيل المضيف.
    </p>

    <p>
      يرجى تحميل إيصال الدفع من لوحة تحكم المضيف لإكمال التسجيل.
    </p>

    <div style="text-align: center; margin: 25px 0;">
      <a
        href="${appUrl}/host-dashboard"
        style="
          background-color: #4F46E5;
          color: white;
          padding: 12px 24px;
          text-decoration: none;
          border-radius: 6px;
          display: inline-block;
        "
      >
        الذهاب إلى لوحة تحكم المضيف ←
      </a>
    </div>

    <p>
      شكراً لاختيارك مرحبا.
    </p>

    <p>
      مع أطيب التحيات،<br>
      فريق مرحبا
    </p>

  </div>

</div>
`;

    return this.sendEmail({
      to: host.email,
      subject:
        "ID Verification Approved / تمت الموافقة على التحقق من الهوية - Marhaba",
      text: `
Dear ${host.name},

Great news! Your identity document has been approved and verified by the Marhaba administration team.

Your ID verification status is now Approved.

You can continue with the next step of your host registration by uploading your payment receipt.

Host Dashboard:
${appUrl}/host-dashboard

Best regards,
Marhaba Team

---

عزيزي ${host.name}،

أخبار رائعة! تمت الموافقة والتحقق من وثيقة هويتك من قبل فريق إدارة مرحبا.

حالة التحقق من هويتك الآن: تمت الموافقة.

يمكنك الانتقال إلى الخطوة التالية من تسجيل المضيف وتحميل إيصال الدفع.

لوحة تحكم المضيف:
${appUrl}/host-dashboard

مع أطيب التحيات،
فريق مرحبا
`,
      html: emailHtml,
    });
  }

  /**
   * Send host ID rejection email
   */
  async sendHostIdRejectedEmail(host, reason) {
    const appUrl = process.env.BASE_URL || "https://mar-haba.ly";

    const rejectionReason = reason || "The ID document was unclear or invalid";

    const rejectionReasonArabic =
      reason || "وثيقة الهوية غير واضحة أو غير صالحة";

    const emailHtml = `
<div style="
  font-family: Arial, 'Cairo', 'Tajawal', sans-serif;
  max-width: 600px;
  margin: auto;
  padding: 20px;
  background: #f7f6f2;
">

  <div style="text-align: center; margin-bottom: 20px;">
    <h1 style="color: #1a1a2e;">
      مر<span style="color: #e8c547;">حبا</span>
    </h1>
  </div>

  <!-- English Section -->
  <div style="margin-bottom: 30px;">

    <h2 style="color: #E24B4A;">
      ❌ ID Verification Rejected
    </h2>

    <p>Dear ${host.name},</p>

    <p>
      We regret to inform you that your identity document
      has been <strong>rejected</strong> by the Marhaba administration team.
    </p>

    <div style="
      background: #FCEBEB;
      padding: 20px;
      border-radius: 12px;
      margin: 20px 0;
      border: 1px solid #E24B4A;
    ">

      <h3 style="
        color: #E24B4A;
        margin-top: 0;
      ">
        📋 Rejection Reason
      </h3>

      <p>
        ${rejectionReason}
      </p>

    </div>

    <p>
      Please upload a new, clear and valid copy of your official
      identification document.
    </p>

    <p>
      Make sure that:
    </p>

    <ul>
      <li>The document is clear and readable.</li>
      <li>All required information is visible.</li>
      <li>The document has not expired.</li>
      <li>The uploaded document belongs to you.</li>
    </ul>

    <div style="text-align: center; margin: 25px 0;">
      <a
        href="${appUrl}/host-dashboard"
        style="
          background-color: #4F46E5;
          color: white;
          padding: 12px 24px;
          text-decoration: none;
          border-radius: 6px;
          display: inline-block;
        "
      >
        Upload New ID →
      </a>
    </div>

    <p>
      If you believe this decision was made in error,
      please contact our support team.
    </p>

    <p>
      Best regards,<br>
      Marhaba Team
    </p>

  </div>

  <div style="border-top: 2px solid #e5e7eb; margin: 25px 0;"></div>

  <!-- Arabic Section -->
  <div style="direction: rtl; text-align: right;">

    <h2 style="color: #E24B4A;">
      ❌ تم رفض التحقق من الهوية
    </h2>

    <p>عزيزي ${host.name}،</p>

    <p>
      نأسف لإبلاغك بأن وثيقة هويتك قد تم
      <strong>رفضها</strong>
      من قبل فريق إدارة مرحبا.
    </p>

    <div style="
      background: #FCEBEB;
      padding: 20px;
      border-radius: 12px;
      margin: 20px 0;
      border: 1px solid #E24B4A;
    ">

      <h3 style="
        color: #E24B4A;
        margin-top: 0;
      ">
        📋 سبب الرفض
      </h3>

      <p>
        ${rejectionReasonArabic}
      </p>

    </div>

    <p>
      يرجى تحميل نسخة جديدة وواضحة وصالحة من وثيقة هويتك الرسمية.
    </p>

    <p>
      يرجى التأكد من أن:
    </p>

    <ul>
      <li>الوثيقة واضحة ويمكن قراءتها.</li>
      <li>جميع المعلومات المطلوبة ظاهرة.</li>
      <li>الوثيقة غير منتهية الصلاحية.</li>
      <li>الوثيقة المرفوعة تخصك.</li>
    </ul>

    <div style="text-align: center; margin: 25px 0;">
      <a
        href="${appUrl}/host-dashboard"
        style="
          background-color: #4F46E5;
          color: white;
          padding: 12px 24px;
          text-decoration: none;
          border-radius: 6px;
          display: inline-block;
        "
      >
        تحميل هوية جديدة ←
      </a>
    </div>

    <p>
      إذا كنت تعتقد أن هذا القرار تم عن طريق الخطأ،
      يرجى التواصل مع فريق الدعم.
    </p>

    <p>
      مع أطيب التحيات،<br>
      فريق مرحبا
    </p>

  </div>

</div>
`;

    return this.sendEmail({
      to: host.email,
      subject: "ID Verification Rejected / تم رفض التحقق من الهوية - Marhaba",
      text: `
Dear ${host.name},

We regret to inform you that your identity document has been rejected.

Reason:
${rejectionReason}

Please upload a new, clear and valid copy of your official ID document.

Host Dashboard:
${appUrl}/host-dashboard

Best regards,
Marhaba Team

---

عزيزي ${host.name}،

نأسف لإبلاغك بأن وثيقة هويتك قد تم رفضها.

السبب:
${rejectionReasonArabic}

يرجى تحميل نسخة جديدة وواضحة وصالحة من وثيقة هويتك الرسمية.

لوحة تحكم المضيف:
${appUrl}/host-dashboard

مع أطيب التحيات،
فريق مرحبا
`,
      html: emailHtml,
    });
  }
}

module.exports = new EmailService();
