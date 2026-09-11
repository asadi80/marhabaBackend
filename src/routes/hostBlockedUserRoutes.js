const express = require("express");

const router = express.Router();

const {
  blockUser,
  getBlockedUsers,
  unblockUser,
} = require("../controllers/hostBlockedUserController");

const { protect } = require("../middleware/auth");

// Block user
router.post("/blocked-user", protect, blockUser);

// Get blocked users
router.get("/blocked-users", protect, getBlockedUsers);

// Unblock user
router.delete("/blocked-users/:userId", protect, unblockUser);

module.exports = router;