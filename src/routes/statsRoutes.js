const express = require("express");

const router = express.Router();

const statsController = require("../controllers/statsController");

// ============================================================
// GET SIMPLE PLATFORM STATISTICS
// GET /api/v1/stats/stats
// ============================================================
router.get("/simple", statsController.getSimpleStats);

module.exports = router;