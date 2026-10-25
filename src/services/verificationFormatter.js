// src/services/verificationFormatter.js
/**
 * Normalizes a user record + documents + payments into a single
 * verification-status shape. Used by both login and the
 * getHostVerificationStatus endpoint.
 *
 * @param {object} user - Prisma user with id_documents + host_subscription_payments
 * @returns {object}
 */
function buildVerificationStatus(user) {
  const idDocuments = Array.isArray(user.id_documents) ? user.id_documents : [];
  const payments = Array.isArray(user.host_subscription_payments)
    ? user.host_subscription_payments
    : [];
  const hostDetails = user.host_details || {};

  // ---------- ID BLOCK ----------
  const latestDoc = idDocuments[0] || null;
  const latestApprovedDoc = idDocuments.find(
    (d) => d.status === "approved" || d.status === "verified",
  );
  const rejectedDoc = idDocuments.find((d) => d.status === "rejected");

  const idBlock = {
    uploaded: idDocuments.length > 0,
    documents: idDocuments.map((d) => ({
      id: d.id,
      status: d.status,
      rejection_reason: d.rejection_reason || null,
      reviewed_at: d.reviewed_at || null,
      created_at: d.created_at || null,
    })),
    status: latestDoc?.status || "pending",
    // "Latest approval wins" — a newly pending upload after approval
    // should NOT flip verified back to false.
    verified: Boolean(latestApprovedDoc),
    verified_at: latestApprovedDoc?.reviewed_at || null,
    rejected: Boolean(rejectedDoc),
    rejection_reason: rejectedDoc?.rejection_reason || null,
  };

  // ---------- PAYMENTS ----------
  const allPayments = payments.map((p) => ({
    id: p.id,
    host_id: p.host_id,
    amount: p.amount,
    status: p.status,
    receipt_images: p.receipt_images || [],
    paid_at: p.paid_at,
    period_start: p.period_start,
    period_end: p.period_end,
    reference: p.reference,
    notes: p.notes,
    created_at: p.created_at,
    updated_at: p.updated_at,
  }));

  const latestPayment = allPayments[0] || null;

  let finalPaymentStatus = latestPayment ? latestPayment.status : "pending";
  const paymentRejected = Boolean(hostDetails.payment_rejected);
  if (paymentRejected && finalPaymentStatus !== "approved") {
    finalPaymentStatus = "rejected";
  }

  const paymentBlock = {
    uploaded: Boolean(
      latestPayment &&
        Array.isArray(latestPayment.receipt_images) &&
        latestPayment.receipt_images.length > 0,
    ),
    status: finalPaymentStatus,
    amount: latestPayment ? latestPayment.amount : null,
    submitted_at: latestPayment ? latestPayment.created_at : null,
    approved_at: hostDetails.payment_verified_at || null,
    rejected: paymentRejected && finalPaymentStatus !== "approved",
    rejection_reason:
      paymentRejected && finalPaymentStatus !== "approved"
        ? hostDetails.payment_rejection_reason || null
        : null,
    payment: latestPayment,
  };

  return {
    id: idBlock,
    payment: paymentBlock,
    all_payments: allPayments,
    overall_status: user.status,
  };
}

module.exports = { buildVerificationStatus };