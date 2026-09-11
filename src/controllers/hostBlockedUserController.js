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
  // If bookingId supplied, verify booking
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
  const existingBlock = await prisma.hostBlockedUser.findUnique({
    where: {
      host_id_user_id: {
        host_id: hostId,
        user_id: userId,
      },
    },
  });

  if (existingBlock) {
    return res.status(409).json({
      success: false,
      message: "User is already blocked",
    });
  }

  // ----------------------------------------------------------
  // Create block
  // ----------------------------------------------------------
  const blockedUser = await prisma.hostBlockedUser.create({
    data: {
      host_id: hostId,
      user_id: userId,
      booking_id: bookingId || null,
      reason: reason || "Blocked by host",
    },
  });

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

  const blockedUsers = await prisma.hostBlockedUser.findMany({
    where: {
      host_id: hostId,
    },

    orderBy: {
      created_at: "desc",
    },

    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          phone_number: true,
        },
      },

      booking: {
        select: {
          id: true,
        },
      },
    },
  });

  return res.status(200).json({
    success: true,

    blockedUsers: blockedUsers.map((block) => ({
      id: block.id,
      user_id: block.user_id,
      host_id: block.host_id,
      booking_id: block.booking_id,
      reason: block.reason,
      created_at: block.created_at,

      user_name: block.user?.name || null,
      user_email: block.user?.email || null,
      user_phone: block.user?.phone_number || null,
    })),
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

  const deleted = await prisma.hostBlockedUser.deleteMany({
    where: {
      host_id: hostId,
      user_id: userId,
    },
  });

  if (deleted.count === 0) {
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