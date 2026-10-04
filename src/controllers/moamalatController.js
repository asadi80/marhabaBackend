const crypto = require("crypto");

const { prisma } = require("../config/database");
const { redisHelpers } = require("../config/redis");
const { asyncHandler } = require("../middleware/errorHandler");

// ============================================================
// MOAMALAT CREDENTIALS (from .env)
// ============================================================
const MID = process.env.MOAMALAT_MERCHANT_ID;
const TID = process.env.MOAMALAT_TERMINAL_ID;
const SECRET_KEY = process.env.MOAMALAT_SECRET_KEY;

// Subscription pricing / duration
const SUBSCRIPTION_AMOUNT_LYD = 500;
const SUBSCRIPTION_DURATION_DAYS = 182;

// ============================================================
// HELPER: Build SHA-256 HMAC uppercase hex
//
// Moamalat rule:
//   1. Sort fields alphabetically by key
//   2. Join pairs with "&" using "key=value"
//   3. HMAC-SHA256 with hex-decoded secret key
//   4. Encode as uppercase hex
// ============================================================
function buildSecureHash(fields) {
  const sortedKeys = Object.keys(fields).sort();

  const dataToHash = sortedKeys.map((key) => `${key}=${fields[key]}`).join("&");

  // Debug log — verify the exact string being hashed.
  // Remove this once payments are confirmed working in production.
  console.log("🔐 Hash input:", dataToHash);

  return crypto
    .createHmac("sha256", Buffer.from(SECRET_KEY, "hex"))
    .update(dataToHash)
    .digest("hex")
    .toUpperCase();
}

// ============================================================
// HELPER: Format date as yyyyMMddHHmm (Libya local time, UTC+2)
// ============================================================
function formatTrxDateTime(date = new Date()) {
  // Convert to Libya local time (UTC+2)
  const libyaTime = new Date(date.getTime() + 2 * 60 * 60 * 1000);

  return (
    libyaTime.getUTCFullYear().toString() +
    String(libyaTime.getUTCMonth() + 1).padStart(2, "0") +
    String(libyaTime.getUTCDate()).padStart(2, "0") +
    String(libyaTime.getUTCHours()).padStart(2, "0") +
    String(libyaTime.getUTCMinutes()).padStart(2, "0")
  );
}

// ============================================================
// @desc    Initiate a Moamalat subscription payment
// @route   POST /api/v1/payments/moamalat/initiate
// @access  Private (Host only)
//
// NOTE: This endpoint does NOT write to the database.
// The payment record is created only inside `verifyMoamalatPayment`
// after Moamalat confirms the payment was completed successfully.
// ============================================================
const initiateMoamalatPayment = asyncHandler(async (req, res) => {
  // ----------------------------------------------------------
  // VALIDATE SERVER CREDENTIALS
  // ----------------------------------------------------------
  if (!MID || !TID || !SECRET_KEY) {
    console.error("❌ Moamalat credentials missing from environment");
    return res.status(500).json({
      success: false,
      message: "Payment gateway not configured",
      code: "MOAMALAT_NOT_CONFIGURED",
    });
  }

  // ----------------------------------------------------------
  // AUTH CONTEXT (set by `protect` + `isHost` middleware)
  // ----------------------------------------------------------
  const userId = req.user?.id;
  const userRole = String(req.user?.role || "").toLowerCase();

  if (!userId) {
    return res.status(401).json({
      success: false,
      message: "Authentication required",
      code: "UNAUTHORIZED",
    });
  }

  if (userRole !== "host") {
    return res.status(403).json({
      success: false,
      message: "Only hosts can initiate subscription payments",
      code: "FORBIDDEN_NOT_HOST",
    });
  }

  // ----------------------------------------------------------
  // BUILD TRANSACTION DATA
  // ----------------------------------------------------------
  // Amount in smallest unit (LYD * 1000)
  const amountTrxn = String(Math.round(SUBSCRIPTION_AMOUNT_LYD * 1000));

  // Unique merchant reference
  const merchantReference = `SUB-${userId.slice(0, 8)}-${Date.now()}`;

  // yyyyMMddHHmm in Libya local time
  const trxDateTime = formatTrxDateTime();

  // ----------------------------------------------------------
  // BUILD SECURE HASH
  //
  // Field names MUST match exactly what the Lightbox's
  // `configure` object sends (see frontend):
  //   MID, TID, AmountTrxn, MerchantReference, TrxDateTime, SecureHash
  //
  // Hash input (alphabetical by key):
  //   AmountTrxn, MerchantId, MerchantReference, TerminalId, TrxDateTime
  // ----------------------------------------------------------
  const secureHash = buildSecureHash({
    Amount: amountTrxn,
    DateTimeLocalTrxn: trxDateTime,
    MerchantId: MID,
    MerchantReference: merchantReference,
    TerminalId: TID,
  });

  console.log("✅ Moamalat payment initiated:", {
    userId,
    merchantReference,
    amountTrxn,
    trxDateTime,
  });

  // ----------------------------------------------------------
  // RETURN CONFIG TO FRONTEND LIGHTBOX
  // (no DB write — DB record is created on verified success)
  // ----------------------------------------------------------
  return res.status(200).json({
    success: true,
    data: {
      merchantCode: MID,
      terminalId: TID,
      amountTrxn,
      merchantReference,
      trxDateTime,
      secureHash,
      amountLYD: SUBSCRIPTION_AMOUNT_LYD,
    },
  });
});

// ============================================================
// @desc    Verify Moamalat callback & activate subscription
// @route   POST /api/v1/payments/moamalat/verify
// @access  Private (Host only)
//
// The payment record is created here ONLY when the payment
// is confirmed successful. Failed/cancelled attempts leave
// no trace in the database.
// ============================================================
const verifyMoamalatPayment = asyncHandler(async (req, res) => {
  // ----------------------------------------------------------
  // AUTH
  // ----------------------------------------------------------
  const userId = req.user?.id;

  if (!userId) {
    return res.status(401).json({
      success: false,
      message: "Authentication required",
      code: "UNAUTHORIZED",
    });
  }

  // ----------------------------------------------------------
  // EXTRACT CALLBACK PAYLOAD
  // ----------------------------------------------------------
  const {
    outcome,
    SystemReference,
    NetworkReference,
    MerchantReference,
    Amount,
    Currency,
    PaidThrough,
    PayerAccount,
    PayerName,
    ProviderSchemeName,
    TxnDate,
    SecureHash: callbackHash,
    error,
    ResponseCode,
    ResponseMessage,
  } = req.body;

  // ----------------------------------------------------------
  // HANDLE NON-COMPLETED OUTCOMES EARLY
  //
  // Cancelled / failed / user-abandoned payments do NOT
  // touch the database. No pending record was created.
  // ----------------------------------------------------------
  if (outcome !== "completed") {
    console.log("⚠️ Moamalat payment not completed:", {
      userId,
      outcome,
      error,
      MerchantReference,
      ResponseCode,
      ResponseMessage,
    });

    return res.status(200).json({
      success: false,
      message:
        outcome === "cancelled"
          ? "Payment was cancelled"
          : ResponseMessage || error || "Payment failed",
      code: outcome === "cancelled" ? "PAYMENT_CANCELLED" : "PAYMENT_FAILED",
      // NEW — forward the gateway response
      responseCode: ResponseCode || null,
      responseMessage: ResponseMessage || error || null,
    });
  }

  // ----------------------------------------------------------
  // VERIFY SECURE HASH FROM CALLBACK
  //
  // Per docs, complete callback hash uses:
  //   AmountTrxn, Currency, MerchantId, MerchantReference,
  //   PaidThrough, TerminalId, TxnDate
  // ----------------------------------------------------------
  if (!callbackHash) {
    return res.status(400).json({
      success: false,
      message: "Missing SecureHash in callback",
      code: "MISSING_SECURE_HASH",
    });
  }

  const expectedHash = buildSecureHash({
    AmountTrxn: Amount,
    Currency: Currency,
    MerchantId: MID,
    MerchantReference: MerchantReference,
    PaidThrough: PaidThrough,
    TerminalId: TID,
    TxnDate: TxnDate,
  });

  if (expectedHash !== callbackHash) {
    console.error("❌ SecureHash mismatch:", {
      expected: expectedHash,
      received: callbackHash,
      MerchantReference,
    });

    return res.status(400).json({
      success: false,
      message: "Invalid SecureHash",
      code: "INVALID_SECURE_HASH",
    });
  }

  // ----------------------------------------------------------
  // IDEMPOTENCY — was this already processed?
  // ----------------------------------------------------------
  const existing = await prisma.hostSubscriptionPayment.findFirst({
    where: {
      reference: MerchantReference,
      host_id: userId,
    },
    orderBy: { created_at: "desc" },
  });

  if (existing && existing.status === "approved") {
    return res.status(200).json({
      success: true,
      message: "Payment already approved",
      data: { status: "approved" },
    });
  }

  // ----------------------------------------------------------
  // CALCULATE SUBSCRIPTION PERIOD
  // Extends from current active period if still valid
  // ----------------------------------------------------------
  const now = new Date();

  const activePayment = await prisma.hostSubscriptionPayment.findFirst({
    where: {
      host_id: userId,
      status: "approved",
      period_end: { gt: now },
    },
    orderBy: { period_end: "desc" },
  });

  const baseDate =
    activePayment && new Date(activePayment.period_end) > now
      ? new Date(activePayment.period_end)
      : now;

  const periodStart = baseDate;
  const periodEnd = new Date(
    baseDate.getTime() + SUBSCRIPTION_DURATION_DAYS * 24 * 60 * 60 * 1000,
  );

  // ----------------------------------------------------------
  // CREATE RECORD + UPDATE USER (atomic)
  //
  // Only runs after successful hash verification.
  // ----------------------------------------------------------
  const result = await prisma.$transaction(async (tx) => {
    const createdPayment = await tx.hostSubscriptionPayment.create({
      data: {
        host_id: userId,
        amount: SUBSCRIPTION_AMOUNT_LYD,
        status: "approved",
        reference: MerchantReference,
        receipt_images: [],
        paid_at: now,
        period_start: periodStart,
        period_end: periodEnd,
        notes: `Paid via Moamalat. Ref: ${
          SystemReference || "N/A"
        }${PayerAccount ? ` | Card: ${PayerAccount}` : ""}`,
      },
    });

    const updatedUser = await tx.user.update({
      where: { id: userId },
      data: {
        status: "active",
        host_expiry_date: periodEnd,
      },
      select: {
        id: true,
        status: true,
        host_expiry_date: true,
      },
    });

    return { payment: createdPayment, user: updatedUser };
  });

  // ----------------------------------------------------------
  // CLEAR CACHES
  // ----------------------------------------------------------
  try {
    await redisHelpers.del(`host-verification:${userId}`);
    await redisHelpers.deletePattern("listings:*");
  } catch (cacheError) {
    console.warn("⚠️ Cache clear failed:", cacheError);
  }

  console.log("✅ Moamalat payment verified:", {
    userId,
    paymentId: result.payment.id,
    periodStart,
    periodEnd,
  });

  // ----------------------------------------------------------
  // RESPONSE
  // ----------------------------------------------------------
  return res.status(200).json({
    success: true,
    message: "Payment verified and subscription updated",
    data: {
      status: "approved",
      amount: SUBSCRIPTION_AMOUNT_LYD,
      reference: MerchantReference,
      period_start: periodStart,
      period_end: periodEnd,
      user_status: result.user.status,
      host_expiry_date: result.user.host_expiry_date,
    },
  });
});

module.exports = {
  initiateMoamalatPayment,
  verifyMoamalatPayment,
};
