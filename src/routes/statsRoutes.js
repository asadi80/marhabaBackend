const express = require("express");

const router = express.Router();

const statsController = require("../controllers/statsController");

// ============================================================
// GET SIMPLE PLATFORM STATISTICS
// GET /api/v1/stats/stats
// ============================================================
router.get("/stats", statsController.getSimpleStats);

module.exports = router;