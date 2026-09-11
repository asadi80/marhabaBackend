const express = require("express");

const router = express.Router();

const {
  getBlockedUsers,
  unblockUser,
} = require("../controllers/hostBlockedUserController");

const {
  protect,
  isHost,
} = require("../middleware/auth");

// Get users blocked by logged-in host
router.get("/blocked-users", protect,isHost, getBlockedUsers);

// Unblock user
router.delete("/blocked-users/:userId", protect,isHost, unblockUser);

module.exports = router;