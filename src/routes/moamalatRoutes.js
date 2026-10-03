const express = require("express");

const router = express.Router();

const moamalatController = require("../controllers/moamalatController");

const { protect, isHost } = require("../middleware/auth");

const {
  handleValidationErrors,
} = require("../middleware/validation");

// ============================================================
// PROTECTED ROUTES — HOST ONLY
// ============================================================

// INITIATE PAYMENT SESSION
// POST /api/v1/payments/moamalat/initiate
router.post(
  "/moamalat/initiate",
  protect,
  isHost,
  handleValidationErrors,
  moamalatController.initiateMoamalatPayment
);

// VERIFY PAYMENT CALLBACK
// POST /api/v1/payments/moamalat/verify
router.post(
  "/moamalat/verify",
  protect,
  isHost,
  handleValidationErrors,
  moamalatController.verifyMoamalatPayment
);

module.exports = router;