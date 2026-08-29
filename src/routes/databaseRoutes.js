const express = require("express");
const router = express.Router();
const adminController = require("../controllers/adminController");
const { protect, authorize } = require("../middleware/auth");
const {
  handleValidationErrors,
  commonValidators,
  userValidators,
  listingValidators,
} = require("../middleware/validation");

const {
  getDatabaseOverview,
  getDatabaseTable,
} = require("../controllers/databaseController");

router.get(
  "/overview",
  authorize("admin", "super_admin"),
  commonValidators.id("id"),
  userValidators.updateProfile,
  handleValidationErrors,
  getDatabaseOverview,
);
router.get(
  "/table/:table",
  authorize("admin", "super_admin"),
  commonValidators.id("id"),
  userValidators.updateProfile,
  handleValidationErrors,
  getDatabaseTable,
);

module.exports = router;
