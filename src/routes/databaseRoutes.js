const express = require("express");

const {
  getDatabaseOverview,
  getDatabaseTable,
} = require("../controllers/databaseController");

const router = express.Router();

router.get("/overview", getDatabaseOverview);
router.get("/table/:table", getDatabaseTable);

module.exports = router;