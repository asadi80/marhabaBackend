const express = require("express");

const router = express.Router();

const {
  protect,
  authorize,
} = require("../middleware/auth");

const {
  getDatabaseOverview,
  getDatabaseTable,
} = require("../controllers/databaseController");

// Database overview
router.get(
  "/overview",
  protect,
  authorize("admin", "super_admin"),
  getDatabaseOverview
);

// Get table data
router.get(
  "/table/:table",
  protect,
  authorize("admin", "super_admin"),
  getDatabaseTable
);

module.exports = router;