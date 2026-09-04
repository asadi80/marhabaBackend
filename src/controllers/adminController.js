// src/controllers/adminController.js

const { prisma } = require("../config/database");
const { redisHelpers } = require("../config/redis");
const { asyncHandler } = require("../middleware/errorHandler");
const emailService = require("../services/emailService");
const bcrypt = require("bcryptjs");

// ============================================================
// DASHBOARD STATISTICS
// ============================================================

// @desc    Get dashboard statistics
// @route   GET /api/v1/admin/stats
// @access  Private (Admin/Super Admin)
const getStats = asyncHandler(async (req, res) => {
  const cachedStats = await redisHelpers.get("admin:stats");

  if (cachedStats) {
    return res.status(200).json({
      success: true,
      stats: cachedStats,
    });
  }

  const [
    totalUsers,
    totalHosts,
    totalAdmins,
    totalSuperAdmins,
    totalListings,
    totalBookings,
    pendingHosts,
    totalRevenue,
  ] = await Promise.all([
    prisma.user.count({
      where: { role: "user" },
    }),

    prisma.user.count({
      where: { role: "host" },
    }),

    prisma.user.count({
      where: { role: "admin" },
    }),

    prisma.user.count({
      where: { role: "super_admin" },
    }),

    prisma.listing.count({
      where: { is_active: true },
    }),

    prisma.booking.count(),

    prisma.user.count({
      where: {
        role: "host",
        status: "pending",
      },
    }),

    prisma.booking.aggregate({
      _sum: {
        total_price: true,
      },
      where: {
        status: "confirmed",
      },
    }),
  ]);

  const stats = {
    totalUsers,
    totalHosts,
    totalAdmins,
    totalSuperAdmins,
    totalListings,
    totalBookings,
    pendingHosts,
    totalRevenue: totalRevenue._sum.total_price || 0,
  };

  await redisHelpers.set("admin:stats", stats, 300);

  res.status(200).json({
    success: true,
    stats,
  });
});

// ============================================================
// USERS
// ============================================================

// @desc    Get all users with filtering
// @route   GET /api/v1/admin/users
// @access  Private (Admin/Super Admin)
const getUsers = asyncHandler(async (req, res) => {
  const { role, status, search, page = 1, limit = 50 } = req.query;

  const pageNumber = parseInt(page);
  const limitNumber = parseInt(limit);

  const skip = (pageNumber - 1) * limitNumber;
  const take = limitNumber;

  const filter = {};

  if (role) {
    filter.role = role;
  }

  if (status) {
    filter.status = status;
  }

  if (search) {
    filter.OR = [
      {
        name: {
          contains: search,
          mode: "insensitive",
        },
      },
      {
        email: {
          contains: search,
          mode: "insensitive",
        },
      },
      {
        phone_number: {
          contains: search,
          mode: "insensitive",
        },
      },
    ];
  }

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where: filter,

      select: {
        id: true,
        name: true,
        email: true,
        phone_number: true,
        role: true,
        status: true,
        status_reason: true,
        email_verified: true,
        created_at: true,
        last_active: true,
        host_expiry_date: true,
        host_details: true,
        user_details: true,

        id_documents: {
          select: {
            id: true,
            document_type: true,
            side: true,
            file_url: true,
            file_name: true,
            file_type: true,
            status: true,
            rejection_reason: true,
            admin_notes: true,
            reviewed_at: true,
            reviewed_by: true,
            created_at: true,
          },
          orderBy: {
            created_at: "desc",
          },
        },

        _count: {
          select: {
            listings: true,
            bookings: true,
            id_documents: true,
          },
        },
      },

      orderBy: {
        created_at: "desc",
      },

      skip,
      take,
    }),

    prisma.user.count({
      where: filter,
    }),
  ]);

  const [usersCount, hostsCount, adminsCount, superAdminsCount] =
    await Promise.all([
      prisma.user.count({
        where: { role: "user" },
      }),

      prisma.user.count({
        where: { role: "host" },
      }),

      prisma.user.count({
        where: { role: "admin" },
      }),

      prisma.user.count({
        where: { role: "super_admin" },
      }),
    ]);

  res.status(200).json({
    success: true,

    users,

    usersByRole: {
      users: usersCount,
      hosts: hostsCount,
      admins: adminsCount,
      super_admins: superAdminsCount,
    },

    pagination: {
      page: pageNumber,
      limit: limitNumber,
      total,
      pages: Math.ceil(total / limitNumber),
    },
  });
});

// @desc    Get single user by ID
// @route   GET /api/v1/admin/users/:id
// @access  Private (Admin/Super Admin)
const getUserById = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const user = await prisma.user.findUnique({
    where: { id },

    include: {
      id_documents: {
        orderBy: {
          created_at: "desc",
        },
      },

      listings: {
        where: {
          is_active: true,
        },
        orderBy: {
          created_at: "desc",
        },
      },

      bookings: {
        orderBy: {
          created_at: "desc",
        },

        include: {
          listing: {
            select: {
              id: true,
              title: true,
              images: true,
            },
          },
        },
      },
      id_documents: {
        orderBy: {
          created_at: "desc",
        },
      },

      host_subscription_payments: {
        orderBy: {
          created_at: "desc",
        },
      },
    },
  });

  if (!user) {
    return res.status(404).json({
      success: false,
      message: "User not found",
    });
  }

  res.status(200).json({
    success: true,
    user,
  });
});

// @desc    Update user
// @route   PUT /api/v1/dashboard/users/:id
// @access  Private (Admin/Super Admin)
const updateUser = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const { name, email, phone_number, role, status, status_reason } = req.body;

  const existingUser = await prisma.user.findUnique({
    where: { id },
  });

  if (!existingUser) {
    return res.status(404).json({
      success: false,
      message: "User not found",
    });
  }

  // Only super admins can modify super admin accounts.
  if (existingUser.role === "super_admin" && req.user.role !== "super_admin") {
    return res.status(403).json({
      success: false,
      message: "Only super admins can modify super admin accounts",
    });
  }

  const updateData = {};

  if (name !== undefined) {
    updateData.name = name.trim();
  }

  if (email !== undefined) {
    updateData.email = email.toLowerCase().trim();
  }

  if (phone_number !== undefined) {
    updateData.phone_number = phone_number.trim();
  }

  // Only super admin can change roles.
  if (role !== undefined && req.user.role === "super_admin") {
    updateData.role = role;
  }

  if (status !== undefined) {
    updateData.status = status;
  }

  if (status_reason !== undefined) {
    updateData.status_reason = status_reason;
  }

  // ==========================================================
  // HOST STATUS CHANGES
  // ==========================================================

  if (existingUser.role === "host" && status !== undefined) {
    const previousStatus = existingUser.status;

    // --------------------------------------------------------
    // PENDING -> CONFIRMED
    // --------------------------------------------------------

    if (status === "confirmed" && previousStatus !== "confirmed") {
      const now = new Date();

      const expiryDate = new Date(now);
      expiryDate.setMonth(expiryDate.getMonth() + 6);

      const daysUntilExpiry = Math.ceil(
        (expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
      );

      updateData.host_details = {
        ...(existingUser.host_details || {}),

        confirmed_at: now,
        expires_at: expiryDate,
        verified: true,
      };

      try {
        const emailResult = await emailService.sendHostConfirmationEmail(
          existingUser,
          expiryDate,
          daysUntilExpiry,
        );

        if (!emailResult.success) {
          console.error("Host confirmation email failed:", emailResult.error);
        }
      } catch (emailError) {
        console.error("Host confirmation email exception:", emailError);
      }
    }

    // --------------------------------------------------------
    // -> PENDING
    // --------------------------------------------------------
    else if (status === "pending" && previousStatus !== "pending") {
      updateData.host_details = {
        ...(existingUser.host_details || {}),

        verified: false,
        confirmed_at: null,
        expires_at: null,
        pending_since: new Date(),
      };

      const adminEmails = process.env.ADMIN_EMAILS
        ? process.env.ADMIN_EMAILS.split(",")
            .map((email) => email.trim())
            .filter(Boolean)
        : [];

      try {
        const emailResult = await emailService.sendHostPendingApproval(
          existingUser,
          adminEmails,
        );

        if (!emailResult.success) {
          console.error(
            "Host pending approval email failed:",
            emailResult.error,
          );
        }
      } catch (emailError) {
        console.error("Host pending approval email exception:", emailError);
      }
    }

    // --------------------------------------------------------
    // -> SUSPENDED
    // --------------------------------------------------------
    else if (status === "suspended" && previousStatus !== "suspended") {
      try {
        const emailResult = await emailService.sendHostSuspensionEmail(
          existingUser.email,
          existingUser.name,
          status_reason || "Violation of terms of service",
        );

        if (!emailResult.success) {
          console.error("Host suspension email failed:", emailResult.error);
        }
      } catch (emailError) {
        console.error("Host suspension email exception:", emailError);
      }
    }

    // --------------------------------------------------------
    // SUSPENDED -> ACTIVE STATUS
    // --------------------------------------------------------
    else if (previousStatus === "suspended" && status !== "suspended") {
      try {
        const emailResult = await emailService.sendHostReactivationEmail(
          existingUser,
          status_reason || "Account has been reactivated",
        );

        if (!emailResult.success) {
          console.error("Host reactivation email failed:", emailResult.error);
        }
      } catch (emailError) {
        console.error("Host reactivation email exception:", emailError);
      }
    }

    // --------------------------------------------------------
    // PENDING -> OTHER
    // --------------------------------------------------------
    else if (
      previousStatus === "pending" &&
      status !== "pending" &&
      status !== "confirmed" &&
      status !== "suspended"
    ) {
      updateData.host_details = {
        ...(existingUser.host_details || {}),
        pending_since: null,
      };
    }
  }

  let updatedUser;

  try {
    updatedUser = await prisma.user.update({
      where: { id },

      data: updateData,

      select: {
        id: true,
        name: true,
        email: true,
        phone_number: true,
        role: true,
        status: true,
        status_reason: true,
        email_verified: true,
        created_at: true,
        last_active: true,
        host_expiry_date: true,
        host_details: true,
        user_details: true,

        id_documents: {
          select: {
            id: true,
            document_type: true,
            side: true,
            file_url: true,
            file_name: true,
            file_type: true,
            status: true,
            rejection_reason: true,
            admin_notes: true,
            reviewed_at: true,
            reviewed_by: true,
          },
          orderBy: {
            created_at: "desc",
          },
        },
      },
    });
  } catch (error) {
    if (error.code === "P2002") {
      return res.status(400).json({
        success: false,
        message: "Email or phone number is already being used",
      });
    }

    throw error;
  }

  await redisHelpers.del(`user:${id}`);
  await redisHelpers.del("admin:stats");

  res.status(200).json({
    success: true,
    message: "User updated successfully",
    user: updatedUser,
  });
});

// ============================================================
// DELETE USER
// ============================================================

// @desc    Delete user
// @route   DELETE /api/v1/admin/users/:id
// @access  Private (Super Admin only)
const deleteUser = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const user = await prisma.user.findUnique({
    where: { id },

    include: {
      listings: {
        select: {
          id: true,
        },
      },
    },
  });

  if (!user) {
    return res.status(404).json({
      success: false,
      message: "User not found",
    });
  }

  if (user.role === "super_admin") {
    if (req.user.role !== "super_admin") {
      return res.status(403).json({
        success: false,
        message: "Only super admins can delete super admin accounts",
      });
    }
  }

  if (user.id === req.user.id) {
    return res.status(400).json({
      success: false,
      message: "You cannot delete your own account",
    });
  }

  const result = await prisma.$transaction(async (tx) => {
    const userListings = await tx.listing.findMany({
      where: {
        host_id: id,
      },
      select: {
        id: true,
      },
    });

    const listingIds = userListings.map((listing) => listing.id);

    let deletedBookingsCount = 0;

    // Remove blocked-user records related to this user/listings.
    await tx.hostBlockedUser.deleteMany({
      where: {
        OR: [{ host_id: id }, { user_id: id }],
      },
    });

    // Delete bookings belonging to listings.
    if (listingIds.length > 0) {
      const deletedHostBookings = await tx.booking.deleteMany({
        where: {
          listing_id: {
            in: listingIds,
          },
        },
      });

      deletedBookingsCount += deletedHostBookings.count;
    }

    // Delete bookings where user is guest.
    const deletedGuestBookings = await tx.booking.deleteMany({
      where: {
        user_id: id,
      },
    });

    deletedBookingsCount += deletedGuestBookings.count;

    // Delete listings.
    const deletedListings = await tx.listing.deleteMany({
      where: {
        host_id: id,
      },
    });

    // UserIdDocument has onDelete: Cascade.
    // UserSession has onDelete: Cascade.
    // UserEvent has onDelete: Cascade.
    // HostSubscriptionPayment has onDelete: Cascade.
    // Therefore Prisma/PostgreSQL will remove those automatically.

    const deletedUser = await tx.user.delete({
      where: {
        id,
      },
    });

    return {
      user: deletedUser,
      listings: deletedListings.count,
      bookings: deletedBookingsCount,
    };
  });

  await redisHelpers.del(`user:${id}`);
  await redisHelpers.del("admin:stats");

  res.status(200).json({
    success: true,
    message: "User deleted successfully",

    deletedCount: {
      user: 1,
      listings: result.listings,
      bookings: result.bookings,
    },
  });
});

// ============================================================
// DASHBOARD DELETE USER
// ============================================================

// @desc    Delete user (Dashboard version)
// @route   DELETE /api/v1/dashboard/users/:id
// @access  Private (Super Admin only)
const deleteDashboardUser = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const user = await prisma.user.findUnique({
    where: { id },

    include: {
      listings: {
        select: {
          id: true,
        },
      },
    },
  });

  if (!user) {
    return res.status(404).json({
      success: false,
      message: "User not found",
    });
  }

  if (user.role === "super_admin" && req.user.role !== "super_admin") {
    return res.status(403).json({
      success: false,
      message: "Only super admins can delete super admin accounts",
    });
  }

  if (user.id === req.user.id) {
    return res.status(400).json({
      success: false,
      message: "You cannot delete your own account",
    });
  }

  const result = await prisma.$transaction(async (tx) => {
    const userListings = await tx.listing.findMany({
      where: {
        host_id: id,
      },

      select: {
        id: true,
      },
    });

    const listingIds = userListings.map((listing) => listing.id);

    let deletedBookingsCount = 0;

    await tx.hostBlockedUser.deleteMany({
      where: {
        OR: [{ host_id: id }, { user_id: id }],
      },
    });

    if (listingIds.length > 0) {
      const deletedHostBookings = await tx.booking.deleteMany({
        where: {
          listing_id: {
            in: listingIds,
          },
        },
      });

      deletedBookingsCount += deletedHostBookings.count;
    }

    const deletedGuestBookings = await tx.booking.deleteMany({
      where: {
        user_id: id,
      },
    });

    deletedBookingsCount += deletedGuestBookings.count;

    const deletedListings = await tx.listing.deleteMany({
      where: {
        host_id: id,
      },
    });

    const deletedUser = await tx.user.delete({
      where: {
        id,
      },
    });

    return {
      user: deletedUser,
      listings: deletedListings.count,
      bookings: deletedBookingsCount,
    };
  });

  await redisHelpers.del(`user:${id}`);
  await redisHelpers.del("admin:stats");

  res.status(200).json({
    success: true,
    message: "User deleted successfully",

    deletedCount: {
      user: 1,
      listings: result.listings,
      bookings: result.bookings,
    },
  });
});

// ============================================================
// USER LISTINGS
// ============================================================

// @desc    Get user's listings
// @route   GET /api/v1/admin/users/:id/listings
// @access  Private (Admin/Super Admin)
const getUserListings = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const listings = await prisma.listing.findMany({
    where: {
      host_id: id,
    },

    orderBy: {
      created_at: "desc",
    },

    include: {
      bookings: {
        where: {
          status: "confirmed",
        },

        select: {
          id: true,
          check_in: true,
          check_out: true,
          status: true,
        },
      },
    },
  });

  res.status(200).json({
    success: true,
    listings,
  });
});

// ============================================================
// USER BOOKINGS
// ============================================================

// @desc    Get user's bookings
// @route   GET /api/v1/admin/users/:id/bookings
// @access  Private (Admin/Super Admin)
const getUserBookings = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const bookingsAsGuest = await prisma.booking.findMany({
    where: {
      user_id: id,
    },

    orderBy: {
      created_at: "desc",
    },

    include: {
      listing: {
        select: {
          id: true,
          title: true,
          images: true,
          host_id: true,
        },
      },
    },
  });

  const bookingsAsHost = await prisma.booking.findMany({
    where: {
      listing: {
        host_id: id,
      },
    },

    orderBy: {
      created_at: "desc",
    },

    include: {
      listing: {
        select: {
          id: true,
          title: true,
          images: true,
        },
      },

      user: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
    },
  });

  res.status(200).json({
    success: true,
    bookingsAsGuest,
    bookingsAsHost,
  });
});

// ============================================================
// USER SESSIONS
// ============================================================

// @desc    Get user's sessions
// @route   GET /api/v1/admin/users/:id/sessions
// @access  Private (Admin/Super Admin)
const getUserSessions = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const sessions = await prisma.userSession.findMany({
    where: {
      user_id: id,
    },

    orderBy: {
      logged_in_at: "desc",
    },
  });

  res.status(200).json({
    success: true,
    sessions,
  });
});

// ============================================================
// USER EVENTS
// ============================================================

// @desc    Get user's events
// @route   GET /api/v1/admin/users/:id/events
// @access  Private (Admin/Super Admin)
const getUserEvents = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const events = await prisma.userEvent.findMany({
    where: {
      user_id: id,
    },

    orderBy: {
      created_at: "desc",
    },

    take: 100,
  });

  res.status(200).json({
    success: true,
    events,
  });
});

// ============================================================
// HOSTS
// ============================================================

// @desc    Get pending hosts
// @route   GET /api/v1/admin/hosts/pending
// @access  Private (Admin/Super Admin)
const getPendingHosts = asyncHandler(async (req, res) => {
  const pendingHosts = await prisma.user.findMany({
    where: {
      role: "host",
      status: "pending",
    },

    select: {
      id: true,
      name: true,
      email: true,
      phone_number: true,
      created_at: true,
      host_expiry_date: true,
      host_details: true,

      id_documents: {
        select: {
          id: true,
          document_type: true,
          side: true,
          file_url: true,
          file_name: true,
          file_type: true,
          status: true,
          rejection_reason: true,
          admin_notes: true,
          reviewed_at: true,
          reviewed_by: true,
          created_at: true,
        },

        orderBy: {
          created_at: "desc",
        },
      },

      _count: {
        select: {
          listings: true,
          id_documents: true,
        },
      },
    },

    orderBy: {
      created_at: "asc",
    },
  });

  res.status(200).json({
    success: true,
    pendingHosts,
  });
});

// @desc    Approve host
// @route   PUT /api/v1/admin/hosts/:id/approve
// @access  Private (Admin/Super Admin)
const approveHost = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const user = await prisma.user.findUnique({
    where: { id },
  });

  if (!user) {
    return res.status(404).json({
      success: false,
      message: "User not found",
    });
  }

  if (user.role !== "host") {
    return res.status(400).json({
      success: false,
      message: "User is not a host",
    });
  }

  if (user.status === "confirmed") {
    return res.status(400).json({
      success: false,
      message: "Host is already confirmed",
    });
  }

  const now = new Date();

  const expiryDate = new Date(now);
  expiryDate.setMonth(expiryDate.getMonth() + 6);

  const updatedUser = await prisma.user.update({
    where: { id },

    data: {
      status: "confirmed",

      host_details: {
        ...(user.host_details || {}),

        verified: true,
        confirmed_at: now,
        expires_at: expiryDate,
      },

      host_expiry_date: expiryDate,

      status_reason: "Host account approved",
    },
  });

  try {
    await emailService.sendHostApprovalEmail(user.email, user.name);
  } catch (error) {
    console.error("Host approval email failed:", error);
  }

  await redisHelpers.del(`user:${id}`);
  await redisHelpers.del("admin:stats");

  res.status(200).json({
    success: true,
    message: "Host approved successfully",

    user: {
      id: updatedUser.id,
      name: updatedUser.name,
      status: updatedUser.status,
      host_expiry_date: updatedUser.host_expiry_date,
    },
  });
});

// @desc    Reject host
// @route   PUT /api/v1/admin/hosts/:id/reject
// @access  Private (Admin/Super Admin)
const rejectHost = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { reason } = req.body;

  const user = await prisma.user.findUnique({
    where: { id },
  });

  if (!user) {
    return res.status(404).json({
      success: false,
      message: "User not found",
    });
  }

  if (user.role !== "host") {
    return res.status(400).json({
      success: false,
      message: "User is not a host",
    });
  }

  const rejectionReason = reason?.trim() || "Host application rejected";

  await prisma.user.update({
    where: { id },

    data: {
      status: "suspended",
      status_reason: rejectionReason,

      host_details: {
        ...(user.host_details || {}),

        verified: false,
        rejected: true,
        rejection_reason: rejectionReason,
      },
    },
  });

  try {
    await emailService.sendHostRejectionEmail(
      user.email,
      user.name,
      rejectionReason,
    );
  } catch (error) {
    console.error("Host rejection email failed:", error);
  }

  await redisHelpers.del(`user:${id}`);
  await redisHelpers.del("admin:stats");

  res.status(200).json({
    success: true,
    message: "Host rejected successfully",
  });
});

// ============================================================
// LISTINGS
// ============================================================

// @desc    Get all listings
// @route   GET /api/v1/admin/listings
// @access  Private (Admin/Super Admin)
const getAllListings = asyncHandler(async (req, res) => {
  const { status, search, page = 1, limit = 20 } = req.query;

  const pageNumber = parseInt(page);
  const limitNumber = parseInt(limit);

  const skip = (pageNumber - 1) * limitNumber;

  const filter = {};

  if (status) {
    filter.status = status;
  }

  if (search) {
    filter.OR = [
      {
        title: {
          contains: search,
          mode: "insensitive",
        },
      },
      {
        description: {
          contains: search,
          mode: "insensitive",
        },
      },
      {
        location: {
          contains: search,
          mode: "insensitive",
        },
      },
    ];
  }

  const [listings, total] = await Promise.all([
    prisma.listing.findMany({
      where: filter,

      include: {
        host: {
          select: {
            id: true,
            name: true,
            email: true,
            phone_number: true,
            status: true,
          },
        },

        bookings: {
          where: {
            status: "confirmed",
          },

          select: {
            id: true,
            check_in: true,
            check_out: true,
          },
        },

        _count: {
          select: {
            bookings: true,
          },
        },
      },

      orderBy: {
        created_at: "desc",
      },

      skip,
      take: limitNumber,
    }),

    prisma.listing.count({
      where: filter,
    }),
  ]);

  res.status(200).json({
    success: true,

    listings,

    pagination: {
      page: pageNumber,
      limit: limitNumber,
      total,
      pages: Math.ceil(total / limitNumber),
    },
  });
});

// @desc    Delete listing
// @route   DELETE /api/v1/admin/listings/:id
// @access  Private (Admin/Super Admin)
const deleteListing = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const listing = await prisma.listing.findUnique({
    where: { id },

    include: {
      bookings: {
        select: {
          id: true,
        },
      },
    },
  });

  if (!listing) {
    return res.status(404).json({
      success: false,
      message: "Listing not found",
    });
  }

  await prisma.$transaction(async (tx) => {
    // Remove blocked entries associated with
    // bookings on this listing.
    await tx.hostBlockedUser.deleteMany({
      where: {
        booking_id: {
          in: listing.bookings.map((booking) => booking.id),
        },
      },
    });

    await tx.booking.deleteMany({
      where: {
        listing_id: id,
      },
    });

    await tx.listing.delete({
      where: {
        id,
      },
    });
  });

  await redisHelpers.del("admin:stats");

  res.status(200).json({
    success: true,
    message: "Listing deleted successfully",

    deletedCount: {
      listing: 1,
      bookings: listing.bookings.length,
    },
  });
});

// ============================================================
// USER REPORT
// ============================================================

// @desc    Get user report
// @route   GET /api/v1/admin/reports/users
// @access  Private (Admin/Super Admin)
const getUserReport = asyncHandler(async (req, res) => {
  const { startDate, endDate } = req.query;

  const dateFilter = {};

  if (startDate) {
    dateFilter.gte = new Date(startDate);
  }

  if (endDate) {
    dateFilter.lte = new Date(endDate);
  }

  const [users, totalUsers] = await Promise.all([
    prisma.user.groupBy({
      by: ["role", "status"],

      _count: {
        id: true,
      },

      where: {
        created_at: dateFilter,
      },
    }),

    prisma.user.count({
      where: {
        created_at: dateFilter,
      },
    }),
  ]);

  const thirtyDaysAgo = new Date();

  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const reportStartDate = startDate ? new Date(startDate) : thirtyDaysAgo;

  const newUsersByDay = await prisma.$queryRaw`
      SELECT
        DATE(created_at) as date,
        COUNT(*) as count
      FROM users
      WHERE created_at >= ${reportStartDate}
      ${
        endDate
          ? prisma.$queryRaw`AND created_at <= ${new Date(endDate)}`
          : prisma.$queryRaw``
      }
      GROUP BY DATE(created_at)
      ORDER BY DATE(created_at) DESC
      LIMIT 30
    `;

  res.status(200).json({
    success: true,

    data: {
      totalUsers,
      breakdown: users,
      newUsersByDay,
    },
  });
});

// ============================================================
// REVENUE REPORT
// ============================================================

// @desc    Get revenue report
// @route   GET /api/v1/admin/reports/revenue
// @access  Private (Admin/Super Admin)
const getRevenueReport = asyncHandler(async (req, res) => {
  const { period = "month" } = req.query;

  let startDate;

  const now = new Date();

  switch (period) {
    case "week":
      startDate = new Date(now);
      startDate.setDate(startDate.getDate() - 7);
      break;

    case "month":
      startDate = new Date(now);
      startDate.setMonth(startDate.getMonth() - 1);
      break;

    case "year":
      startDate = new Date(now);
      startDate.setFullYear(startDate.getFullYear() - 1);
      break;

    default:
      startDate = new Date(now);
      startDate.setMonth(startDate.getMonth() - 1);
  }

  const [revenue, revenueByDay] = await Promise.all([
    prisma.booking.aggregate({
      _sum: {
        total_price: true,
      },

      _count: {
        id: true,
      },

      where: {
        status: "confirmed",

        created_at: {
          gte: startDate,
        },
      },
    }),

    prisma.$queryRaw`
        SELECT
          DATE(created_at) as date,
          SUM(total_price) as revenue,
          COUNT(*) as bookings
        FROM bookings
        WHERE status = 'confirmed'
        AND created_at >= ${startDate}
        GROUP BY DATE(created_at)
        ORDER BY DATE(created_at) DESC
      `,
  ]);

  res.status(200).json({
    success: true,

    data: {
      totalRevenue: revenue._sum.total_price || 0,

      totalBookings: revenue._count.id || 0,

      period,

      revenueByDay,
    },
  });
});

// ============================================================
// PAYMENTS
// ============================================================

// @desc    Get all subscription payments
// @route   GET /api/v1/admin/payments
// @access  Private (Admin/Super Admin)
const getPayments = asyncHandler(async (req, res) => {
  const { status, host_id, page = 1, limit = 20 } = req.query;

  const pageNumber = parseInt(page);
  const limitNumber = parseInt(limit);

  const where = {};

  if (status) {
    where.status = status;
  }

  if (host_id) {
    where.host_id = host_id;
  }

  const skip = (pageNumber - 1) * limitNumber;

  const [payments, total] = await Promise.all([
    prisma.hostSubscriptionPayment.findMany({
      where,

      include: {
        host: {
          select: {
            id: true,
            name: true,
            email: true,
            phone_number: true,
            role: true,
            status: true,
          },
        },
      },

      orderBy: {
        created_at: "desc",
      },

      skip,
      take: limitNumber,
    }),

    prisma.hostSubscriptionPayment.count({
      where,
    }),
  ]);

  res.status(200).json({
    success: true,

    data: payments,

    pagination: {
      page: pageNumber,
      limit: limitNumber,
      total,
      pages: Math.ceil(total / limitNumber),
    },
  });
});

// @desc    Get single payment
// @route   GET /api/v1/admin/payments/:paymentId
// @access  Private (Admin/Super Admin)
const getPayment = asyncHandler(async (req, res) => {
  const { paymentId } = req.params;

  const payment = await prisma.hostSubscriptionPayment.findUnique({
    where: {
      id: paymentId,
    },

    include: {
      host: {
        select: {
          id: true,
          name: true,
          email: true,
          phone_number: true,
          role: true,
          status: true,
          host_expiry_date: true,
          host_details: true,

          id_documents: {
            select: {
              id: true,
              document_type: true,
              side: true,
              file_url: true,
              status: true,
              rejection_reason: true,
            },
          },
        },
      },
    },
  });

  if (!payment) {
    return res.status(404).json({
      success: false,
      message: "Payment not found",
    });
  }

  res.status(200).json({
    success: true,
    data: payment,
  });
});

// @desc    Approve payment
// @route   PUT /api/v1/admin/payments/:paymentId/approve
// @access  Private (Admin/Super Admin)
const approvePayment = asyncHandler(async (req, res) => {
  const { paymentId } = req.params;
  const { notes } = req.body;

  const payment = await prisma.hostSubscriptionPayment.findUnique({
    where: {
      id: paymentId,
    },

    include: {
      host: true,
    },
  });

  if (!payment) {
    return res.status(404).json({
      success: false,
      message: "Payment not found",
    });
  }

  if (payment.status === "approved") {
    return res.status(400).json({
      success: false,
      message: "Payment is already approved",
    });
  }

  const now = new Date();

  const expiryDate = new Date(now);

  expiryDate.setMonth(expiryDate.getMonth() + 6);

  const updatedPayment = await prisma.hostSubscriptionPayment.update({
    where: {
      id: paymentId,
    },

    data: {
      status: "approved",
      paid_at: now,
      period_start: now,
      period_end: expiryDate,
      notes: notes || payment.notes,
    },

    include: {
      host: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
    },
  });

  const hostDetails = payment.host.host_details || {};

  await prisma.user.update({
    where: {
      id: payment.host_id,
    },

    data: {
      host_details: {
        ...hostDetails,

        payment_verified: true,
        payment_verified_at: now,
        payment_rejected: false,
        payment_rejection_reason: null,
      },

      host_expiry_date: expiryDate,
    },
  });

  try {
    await emailService.sendHostPaymentApprovedEmail(
      payment.host,
      updatedPayment,
      expiryDate,
    );
  } catch (error) {
    console.error("Payment approval email failed:", error);
  }

  await redisHelpers.del(`user:${payment.host_id}`);

  await redisHelpers.del("admin:stats");

  res.status(200).json({
    success: true,
    message: "Payment approved successfully",
    data: updatedPayment,
  });
});

// @desc    Reject payment
// @route   PUT /api/v1/admin/payments/:paymentId/reject
// @access  Private (Admin/Super Admin)
const rejectPayment = asyncHandler(async (req, res) => {
  const { paymentId } = req.params;
  const { reason } = req.body;

  if (!reason || !reason.trim()) {
    return res.status(400).json({
      success: false,
      message: "Rejection reason is required",
    });
  }

  const payment = await prisma.hostSubscriptionPayment.findUnique({
    where: {
      id: paymentId,
    },

    include: {
      host: true,
    },
  });

  if (!payment) {
    return res.status(404).json({
      success: false,
      message: "Payment not found",
    });
  }

  if (payment.status === "rejected") {
    return res.status(400).json({
      success: false,
      message: "Payment is already rejected",
    });
  }

  const rejectionReason = reason.trim();

  const updatedPayment = await prisma.hostSubscriptionPayment.update({
    where: {
      id: paymentId,
    },

    data: {
      status: "rejected",
      notes: rejectionReason,
    },

    include: {
      host: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
    },
  });

  const hostDetails = payment.host.host_details || {};

  await prisma.user.update({
    where: {
      id: payment.host_id,
    },

    data: {
      host_details: {
        ...hostDetails,

        payment_verified: false,
        payment_verified_at: null,
        payment_rejected: true,
        payment_rejection_reason: rejectionReason,
      },
    },
  });

  try {
    await emailService.sendHostPaymentRejectedEmail(
      payment.host,
      updatedPayment,
      rejectionReason,
    );
  } catch (error) {
    console.error("Payment rejection email failed:", error);
  }

  await redisHelpers.del(`user:${payment.host_id}`);

  await redisHelpers.del("admin:stats");

  res.status(200).json({
    success: true,
    message: "Payment rejected successfully",
    data: updatedPayment,
  });
});

// @desc    Get payment statistics
// @route   GET /api/v1/admin/payments/stats
// @access  Private (Admin/Super Admin)
const getPaymentStats = asyncHandler(async (req, res) => {
  const [total, pending, approved, rejected] = await Promise.all([
    prisma.hostSubscriptionPayment.count(),

    prisma.hostSubscriptionPayment.count({
      where: {
        status: "pending",
      },
    }),

    prisma.hostSubscriptionPayment.count({
      where: {
        status: "approved",
      },
    }),

    prisma.hostSubscriptionPayment.count({
      where: {
        status: "rejected",
      },
    }),
  ]);

  const approvedPayments = await prisma.hostSubscriptionPayment.aggregate({
    where: {
      status: "approved",
    },

    _sum: {
      amount: true,
    },
  });

  res.status(200).json({
    success: true,

    data: {
      total,
      pending,
      approved,
      rejected,

      totalApprovedAmount: approvedPayments._sum.amount || 0,
    },
  });
});

// ============================================================
// ID DOCUMENT VERIFICATION
// ============================================================

// @desc    Approve user's ID documents
// @route   PUT /api/v1/admin/users/:id/id/approve
// @access  Private (Admin/Super Admin)
const approveUserId = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { notes } = req.body;

  const user = await prisma.user.findUnique({
    where: { id },

    include: {
      id_documents: true,
    },
  });

  if (!user) {
    return res.status(404).json({
      success: false,
      message: "User not found",
    });
  }

  if (!user.id_documents || user.id_documents.length === 0) {
    return res.status(400).json({
      success: false,
      message: "User has not uploaded any ID documents",
    });
  }

  const pendingDocuments = user.id_documents.filter(
    (document) => document.status !== "approved",
  );

  if (pendingDocuments.length === 0) {
    return res.status(400).json({
      success: false,
      message: "ID is already approved",
    });
  }

  const now = new Date();

  const result = await prisma.$transaction(async (tx) => {
    // Approve all documents belonging to this user.
    await tx.userIdDocument.updateMany({
      where: {
        user_id: id,
      },

      data: {
        status: "approved",
        rejection_reason: null,
        admin_notes: notes || null,
        reviewed_at: now,
        reviewed_by: req.user.id,
      },
    });

    const hostDetails = user.host_details || {};

    const updatedHostDetails = {
      ...hostDetails,

      id_verified: true,
      id_verified_at: now,

      id_rejected: false,
      id_rejection_reason: null,
    };

    return tx.user.update({
      where: { id },

      data: {
        host_details: updatedHostDetails,
      },

      include: {
        id_documents: {
          orderBy: {
            created_at: "desc",
          },
        },
      },
    });
  });

  await redisHelpers.del(`user:${id}`);
  await redisHelpers.del("admin:stats");

  res.status(200).json({
    success: true,
    message: "ID approved successfully",
    user: result,
  });
});

// @desc    Reject user's ID documents
// @route   PUT /api/v1/admin/users/:id/id/reject
// @access  Private (Admin/Super Admin)
const rejectUserId = asyncHandler(async (req, res) => {
  const { documentId } = req.params;
  const { reason } = req.body;

  // Validate rejection reason
  if (!reason || !reason.trim()) {
    return res.status(400).json({
      success: false,
      message: "Rejection reason is required",
    });
  }

  const rejectionReason = reason.trim();

  // Find user and ID documents
  const user = await prisma.user.findUnique({
    where: {
      id: documentId,
    },
    include: {
      id_documents: true,
    },
  });

  if (!user) {
    return res.status(404).json({
      success: false,
      message: "User not found",
    });
  }

  // Check if user has uploaded ID documents
  if (!user.id_documents || user.id_documents.length === 0) {
    return res.status(400).json({
      success: false,
      message: "User has not uploaded any ID documents",
    });
  }

  // Check if all documents are already rejected
  const documentsToReject = user.id_documents.filter(
    (document) => document.status !== "rejected"
  );

  if (documentsToReject.length === 0) {
    return res.status(400).json({
      success: false,
      message: "ID is already rejected",
    });
  }

  const now = new Date();

  // Update ID documents + user inside one transaction
  const result = await prisma.$transaction(async (tx) => {
    // Reject all ID documents belonging to this user
    await tx.userIdDocument.updateMany({
      where: {
        user_id: documentId,
      },
      data: {
        status: "rejected",
        rejection_reason: rejectionReason,
        admin_notes: null,
        reviewed_at: now,
        reviewed_by: req.user.id,
      },
    });

    // Update host details
    const hostDetails = user.host_details || {};

    const updatedHostDetails = {
      ...hostDetails,
      id_verified: false,
      id_verified_at: null,
      id_rejected: true,
      id_rejection_reason: rejectionReason,
    };

    // Update user
    return tx.user.update({
      where: {
        id: documentId,
      },
      data: {
        host_details: updatedHostDetails,
      },
      include: {
        id_documents: {
          orderBy: {
            created_at: "desc",
          },
        },
      },
    });
  });

  // Send ID rejection email
  try {
    await emailService.sendHostIdRejectedEmail(
      user,
      rejectionReason
    );
  } catch (error) {
    console.error("ID rejection email failed:", error);
  }

  // Clear Redis cache
  await redisHelpers.del(`user:${documentId}`);
  await redisHelpers.del("admin:stats");

  // Response
  res.status(200).json({
    success: true,
    message: "ID rejected successfully",
    data: result,
  });
});

// @desc    Set user's ID documents back to pending
// @route   PUT /api/v1/admin/users/:id/id/pending
// @access  Private (Admin/Super Admin)
const setUserIdPending = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { reason } = req.body;

  const user = await prisma.user.findUnique({
    where: { id },

    include: {
      id_documents: true,
    },
  });

  if (!user) {
    return res.status(404).json({
      success: false,
      message: "User not found",
    });
  }

  if (!user.id_documents || user.id_documents.length === 0) {
    return res.status(400).json({
      success: false,
      message: "User has not uploaded any ID documents",
    });
  }

  const now = new Date();

  const result = await prisma.$transaction(async (tx) => {
    await tx.userIdDocument.updateMany({
      where: {
        user_id: id,
      },

      data: {
        status: "pending",
        rejection_reason: null,
        admin_notes: reason?.trim() || null,
        reviewed_at: null,
        reviewed_by: null,
      },
    });

    const hostDetails = user.host_details || {};

    const updatedHostDetails = {
      ...hostDetails,

      id_verified: false,
      id_verified_at: null,

      id_rejected: false,
      id_rejection_reason: null,
    };

    return tx.user.update({
      where: { id },

      data: {
        host_details: updatedHostDetails,
      },

      include: {
        id_documents: {
          orderBy: {
            created_at: "desc",
          },
        },
      },
    });
  });

  await redisHelpers.del(`user:${id}`);
  await redisHelpers.del("admin:stats");

  res.status(200).json({
    success: true,
    message: "ID status changed to pending",
    user: result,
  });
});

// ============================================================
// CREATE ADMIN
// ============================================================

// @desc    Create admin or super_admin
// @route   POST /api/v1/dashboard/createAdmin
// @access  Private (Super Admin only)
const createAdmin = asyncHandler(async (req, res) => {
  const { name, email, password, phone_number, role = "admin" } = req.body;

  if (req.user.role !== "super_admin") {
    return res.status(403).json({
      success: false,
      message: "Only super admins can create new admin accounts",
    });
  }

  if (!name || !email || !password || !phone_number) {
    return res.status(400).json({
      success: false,
      message: "Name, email, password and phone number are required",
    });
  }

  if (!["admin", "super_admin"].includes(role)) {
    return res.status(400).json({
      success: false,
      message: "Role must be admin or super_admin",
    });
  }

  const normalizedEmail = email.toLowerCase().trim();

  const existingUser = await prisma.user.findUnique({
    where: {
      email: normalizedEmail,
    },
  });

  if (existingUser) {
    return res.status(400).json({
      success: false,
      message: "User already exists with this email",
    });
  }

  const salt = await bcrypt.genSalt(10);

  const hashedPassword = await bcrypt.hash(password, salt);

  const user = await prisma.user.create({
    data: {
      name: name.trim(),
      email: normalizedEmail,
      password_hash: hashedPassword,
      phone_number: phone_number.trim(),

      role,

      status: "confirmed",

      email_verified: true,

      user_details: {
        preferences: {},
        bookings: [],
      },
    },
  });

  try {
    const emailResult = await emailService.sendAdminWelcomeEmail(
      normalizedEmail,
      name,
      role,
    );

    if (!emailResult.success) {
      console.error(
        "Admin created, but welcome email failed:",
        emailResult.error,
      );
    }
  } catch (error) {
    console.error("Admin welcome email exception:", error);
  }

  const { password_hash, ...userWithoutPassword } = user;

  res.status(201).json({
    success: true,

    message: `${role} created successfully`,

    user: userWithoutPassword,
  });
});

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  getStats,

  getUsers,
  getUserById,
  updateUser,

  deleteUser,
  deleteDashboardUser,

  createAdmin,

  getUserListings,
  getUserBookings,
  getUserSessions,
  getUserEvents,

  getPendingHosts,
  approveHost,
  rejectHost,

  getAllListings,
  deleteListing,

  getUserReport,
  getRevenueReport,

  getPayments,
  getPayment,
  approvePayment,
  rejectPayment,
  getPaymentStats,

  setUserIdPending,
  approveUserId,
  rejectUserId,
};
