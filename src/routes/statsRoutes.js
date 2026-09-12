const express = require("express");

const router = express.Router();

const statsController = require("../controllers/statsController");

// ============================================================
// GET SIMPLE PLATFORM STATISTICS
// GET /api/v1/stats/stats
// ============================================================
router.get("/simple", statsController.getSimpleStats);

router.get("/test", (req, res) => {
  res.json({
    success: true,
    message: "Stats route is working",
  });
});

module.exports = router;