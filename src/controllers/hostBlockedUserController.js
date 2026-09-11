const { prisma } = require("../config/database");
const { asyncHandler } = require("../middleware/errorHandler");

// ============================================================
// POST — Block a user by this host
// POST /api/v1/host/blocked-users
// ============================================================
const blockUser = asyncHandler(async (req, res) => {
  const hostId = req.user.id;

  const { userId, bookingId, reason } = req.body;

  // ----------------------------------------------------------
  // Validate user ID
  // ----------------------------------------------------------
  if (!userId) {
    return res.status(400).json({
      success: false,
      message: "userId is required",
    });
  }

  // ----------------------------------------------------------
  // Host cannot block themselves
  // ----------------------------------------------------------
  if (userId === hostId) {
    return res.status(400).json({
      success: false,
      message: "You cannot block yourself",
    });
  }

  // ----------------------------------------------------------
  // Check that the user exists
  // ----------------------------------------------------------
  const user = await prisma.user.findUnique({
    where: {
      id: userId,
    },
    select: {
      id: true,
      name: true,
      email: true,
      phone_number: true,
    },
  });

  if (!user) {
    return res.status(404).json({
      success: false,
      message: "User not found",
    });
  }

  // ----------------------------------------------------------
  // If bookingId was supplied, verify:
  //
  // 1. Booking exists
  // 2. Booking belongs to this host
  // 3. Booking belongs to the same user
  // ----------------------------------------------------------
  if (bookingId) {
    const booking = await prisma.booking.findUnique({
      where: {
        id: bookingId,
      },
      select: {
        id: true,
        user_id: true,
        listing: {
          select: {
            host_id: true,
          },
        },
      },
    });

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: "Booking not found",
      });
    }

    if (booking.listing?.host_id !== hostId) {
      return res.status(403).json({
        success: false,
        message: "You can only block users from your own listings",
      });
    }

    if (booking.user_id !== userId) {
      return res.status(400).json({
        success: false,
        message: "Booking does not belong to this user",
      });
    }
  }

  // ----------------------------------------------------------
  // Check if already blocked
  // ----------------------------------------------------------
  const existingBlock = await prisma.$queryRaw`
    SELECT id
    FROM host_blocked_users
    WHERE host_id = ${hostId}
      AND user_id = ${userId}
    LIMIT 1
  `;

  if (existingBlock.length > 0) {
    return res.status(409).json({
      success: false,
      message: "User is already blocked",
    });
  }

  // ----------------------------------------------------------
  // Create block
  // ----------------------------------------------------------
  const result = await prisma.$queryRaw`
    INSERT INTO host_blocked_users (
      user_id,
      host_id,
      booking_id,
      reason,
      created_at
    )
    VALUES (
      ${userId},
      ${hostId},
      ${bookingId || null},
      ${reason || null},
      NOW()
    )
    RETURNING
      id,
      user_id,
      host_id,
      booking_id,
      reason,
      created_at
  `;

  const blockedUser = result[0];

  return res.status(201).json({
    success: true,
    message: "User blocked successfully",
    blockedUser: {
      ...blockedUser,
      user_name: user.name,
      user_email: user.email,
      user_phone: user.phone_number,
    },
  });
});

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
    JOIN users u
      ON hbu.user_id = u.id
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
  blockUser,
  getBlockedUsers,
  unblockUser,
};