const { prisma } = require("../config/database");
const { asyncHandler } = require("../middleware/errorHandler");

// ============================================================
// GET — List all users blocked by this host
// GET /api/v1/host/blocked-users
// ============================================================
const getBlockedUsers = asyncHandler(async (req, res) => {
  const hostId = req.user.id;

  const blockedUsers = await prisma.$queryRaw`
    SELECT
      hbu.id,
      hbu.user_id,
      hbu.host_id,
      hbu.booking_id,
      hbu.reason,
      hbu.created_at,
      u.name AS user_name,
      u.email AS user_email,
      u.phone_number AS user_phone
    FROM host_blocked_users hbu
    JOIN users u ON hbu.user_id = u.id
    WHERE hbu.host_id = ${hostId}
    ORDER BY hbu.created_at DESC
  `;

  return res.status(200).json({
    success: true,
    blockedUsers,
  });
});

// ============================================================
// DELETE — Unblock a user
// DELETE /api/v1/host/blocked-users/:userId
// ============================================================
const unblockUser = asyncHandler(async (req, res) => {
  const hostId = req.user.id;
  const { userId } = req.params;

  if (!userId) {
    return res.status(400).json({
      success: false,
      message: "userId is required",
    });
  }

  const deleted = await prisma.$executeRaw`
    DELETE FROM host_blocked_users
    WHERE host_id = ${hostId}
      AND user_id = ${userId}
  `;

  if (deleted === 0) {
    return res.status(404).json({
      success: false,
      message: "Block record not found",
    });
  }

  return res.status(200).json({
    success: true,
    message: "User unblocked successfully",
  });
});

module.exports = {
  getBlockedUsers,
  unblockUser,
};