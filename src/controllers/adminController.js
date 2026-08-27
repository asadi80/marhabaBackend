// src/controllers/adminController.js
const { prisma } = require("../config/database");
const { redisHelpers } = require("../config/redis");
const { asyncHandler } = require("../middleware/errorHandler");
const { USER_STATUS, ROLES } = require("../utils/constants");
const emailService = require("../services/emailService");
const bcrypt = require("bcryptjs");

// @desc    Get dashboard statistics
// @route   GET /api/v1/admin/stats
// @access  Private (Admin/Super Admin)
const getStats = asyncHandler(async (req, res) => {
  // Check cache first
  const cachedStats = await redisHelpers.get("admin:stats");
  if (cachedStats) {
    return res.status(200).json({
      success: true,
      stats: cachedStats,
    });
  }

  // Get all stats in parallel
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
    prisma.user.count({ where: { role: "user" } }),
    prisma.user.count({ where: { role: "host" } }),
    prisma.user.count({ where: { role: "admin" } }),
    prisma.user.count({ where: { role: "super_admin" } }),
    prisma.listing.count({ where: { is_active: true } }),
    prisma.booking.count(),
    prisma.user.count({
      where: {
        role: "host",
        status: "pending",
      },
    }),
    prisma.booking.aggregate({
      _sum: { total_price: true },
      where: { status: "confirmed" },
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

  // Cache stats for 5 minutes
  await redisHelpers.set("admin:stats", stats, 300);

  res.status(200).json({
    success: true,
    stats,
  });
});

// @desc    Get all users with filtering
// @route   GET /api/v1/admin/users
// @access  Private (Admin/Super Admin)
const getUsers = asyncHandler(async (req, res) => {
  const { role, status, search, page = 1, limit = 50 } = req.query;

  const skip = (parseInt(page) - 1) * parseInt(limit);
  const take = parseInt(limit);

  // Build filter
  const filter = {};
  if (role) filter.role = role;
  if (status) filter.status = status;
  if (search) {
    filter.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { email: { contains: search, mode: "insensitive" } },
      { phone_number: { contains: search, mode: "insensitive" } },
    ];
  }

  // Get users with pagination
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
        email_verified: true,
        created_at: true,
        last_active: true,
        id_images: true,
        host_details: true,
        user_details: true,
        _count: {
          select: {
            listings: true,
            bookings: true,
          },
        },
      },
      orderBy: { created_at: "desc" },
      skip,
      take,
    }),
    prisma.user.count({ where: filter }),
  ]);

  // Group users by role for the sidebar counts
  const usersByRole = await Promise.all([
    prisma.user.count({ where: { role: "user" } }),
    prisma.user.count({ where: { role: "host" } }),
    prisma.user.count({ where: { role: "admin" } }),
    prisma.user.count({ where: { role: "super_admin" } }),
  ]);

  res.status(200).json({
    success: true,
    users,
    usersByRole: {
      users: usersByRole[0],
      hosts: usersByRole[1],
      admins: usersByRole[2],
      super_admins: usersByRole[3],
    },
    pagination: {
      page: parseInt(page),
      limit: parseInt(limit),
      total,
      pages: Math.ceil(total / parseInt(limit)),
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
      listings: {
        where: {
          is_active: true,
        },
        orderBy: {
          created_at: 'desc',
        },
      },

      bookings: {
        orderBy: {
          created_at: 'desc',
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

      host_subscription_payments: {
        orderBy: {
          created_at: 'desc',
        },
      },
    },
  });

  if (!user) {
    return res.status(404).json({
      success: false,
      message: 'User not found',
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

  // Check if user exists
  const existingUser = await prisma.user.findUnique({
    where: { id },
  });

  if (!existingUser) {
    return res.status(404).json({
      success: false,
      message: "User not found",
    });
  }

  // Check if trying to change role of super_admin (only super_admin can do this)
  if (
    role &&
    existingUser.role === "super_admin" &&
    req.user.role !== "super_admin"
  ) {
    return res.status(403).json({
      success: false,
      message: "Only super admins can modify super admin accounts",
    });
  }

  // Build update data
  const updateData = {};
  if (name) updateData.name = name;
  if (email) updateData.email = email.toLowerCase();
  if (phone_number) updateData.phone_number = phone_number;
  if (role && req.user.role === "super_admin") updateData.role = role;
  if (status) updateData.status = status;
  if (status_reason !== undefined) updateData.status_reason = status_reason;

  // If host is being confirmed, set confirmation date and 6-month expiry
  if (status === "confirmed" && existingUser.role === "host") {
    const now = new Date();
    const expiryDate = new Date(now);
    expiryDate.setMonth(expiryDate.getMonth() + 6);

    updateData.host_details = {
      ...existingUser.host_details,
      confirmed_at: now,
      expires_at: expiryDate,
      verified: true,
    };

    // Send confirmation email
    await emailService.sendHostConfirmationEmail(
      existingUser.email,
      existingUser.name,
    );
  }

  // If host is being suspended, send notification
  if (status === "suspended" && existingUser.role === "host") {
    await emailService.sendHostSuspensionEmail(
      existingUser.email,
      existingUser.name,
      status_reason || "Violation of terms of service",
    );
  }

  const updatedUser = await prisma.user.update({
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
      id_images: true,
      host_details: true,
      user_details: true,
    },
  });

  // Clear cache
  await redisHelpers.del(`user:${id}`);
  await redisHelpers.del("admin:stats");

  res.status(200).json({
    success: true,
    message: "User updated successfully",
    user: updatedUser,
  });
});

// @desc    Delete user and all associated data
// @route   DELETE /api/v1/admin/users/:id
// @access  Private (Super Admin only)
const deleteUser = asyncHandler(async (req, res) => {
  const { id } = req.params;

  // Check if user exists
  const user = await prisma.user.findUnique({
    where: { id },
    include: {
      listings: {
        select: { id: true },
      },
    },
  });

  if (!user) {
    return res.status(404).json({
      success: false,
      message: "User not found",
    });
  }

  // Prevent deleting super_admin unless current user is super_admin
  if (user.role === "super_admin" && req.user.role !== "super_admin") {
    return res.status(403).json({
      success: false,
      message: "Only super admins can delete super admin accounts",
    });
  }

  // Prevent deleting self
  if (user.id === req.user.id) {
    return res.status(400).json({
      success: false,
      message: "You cannot delete your own account",
    });
  }

  // Use transaction to delete all associated data
  const result = await prisma.$transaction(async (prisma) => {
    // Get all listing IDs for this user
    const userListings = await prisma.listing.findMany({
      where: { host_id: id },
      select: { id: true },
    });

    const listingIds = userListings.map((l) => l.id);

    let deletedBookingsCount = 0;

    // Delete bookings on user's listings (as host)
    if (listingIds.length > 0) {
      const deletedHostBookings = await prisma.booking.deleteMany({
        where: {
          listing_id: {
            in: listingIds,
          },
        },
      });
      deletedBookingsCount += deletedHostBookings.count;
    }

    // Delete bookings where user is the guest
    const deletedGuestBookings = await prisma.booking.deleteMany({
      where: {
        user_id: id,
      },
    });
    deletedBookingsCount += deletedGuestBookings.count;

    // Delete user's listings
    const deletedListings = await prisma.listing.deleteMany({
      where: { host_id: id },
    });

    // Delete user's sessions
    await prisma.userSession.deleteMany({
      where: { user_id: id },
    });

    // Delete user's events
    await prisma.userEvent.deleteMany({
      where: { user_id: id },
    });

    // Delete user
    const deletedUser = await prisma.user.delete({
      where: { id },
    });

    return {
      user: deletedUser,
      listings: deletedListings.count,
      bookings: deletedBookingsCount,
    };
  });

  // Clear cache
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

// @desc    Create admin or super_admin
// @route   POST /api/v1/dashboard/createAdmin
// @access  Private (Super Admin only)
const createAdmin = asyncHandler(async (req, res) => {
  const { name, email, password, phone_number, role = "admin" } = req.body;

  // Only super_admin can create new admins
  if (req.user.role !== "super_admin") {
    return res.status(403).json({
      success: false,
      message: "Only super admins can create new admin accounts",
    });
  }

  // Check if user exists
  const existingUser = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
  });

  if (existingUser) {
    return res.status(400).json({
      success: false,
      message: "User already exists with this email",
    });
  }

  // Hash password
  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(password, salt);

  // Create user
  const user = await prisma.user.create({
    data: {
      name: name.trim(),
      email: email.toLowerCase(),
      password_hash: hashedPassword,
      phone_number: phone_number.trim(),
      role: role,
      status: "confirmed",
      email_verified: true,
      user_details: {
        preferences: {},
        bookings: [],
      },
    },
  });

  // Send welcome email
  const emailResult = await emailService.sendAdminWelcomeEmail(
    email,
    name,
    role,
  );

  if (!emailResult.success) {
    console.error(
      "⚠️ Admin created, but welcome email failed:",
      emailResult.error,
    );
  }
  const { password_hash, ...userWithoutPassword } = user;

  res.status(201).json({
    success: true,
    message: `${role} created successfully`,
    user: userWithoutPassword,
  });
});
// @desc    Delete user (Dashboard version)
// @route   DELETE /api/v1/dashboard/users/:id
// @access  Private (Super Admin only)
const deleteDashboardUser = asyncHandler(async (req, res) => {
  const { id } = req.params;

  // Check if user exists
  const user = await prisma.user.findUnique({
    where: { id },
    include: {
      listings: {
        select: { id: true },
      },
    },
  });

  if (!user) {
    return res.status(404).json({
      success: false,
      message: "User not found",
    });
  }

  // Prevent deleting super_admin unless current user is super_admin
  if (user.role === "super_admin" && req.user.role !== "super_admin") {
    return res.status(403).json({
      success: false,
      message: "Only super admins can delete super admin accounts",
    });
  }

  // Prevent deleting self
  if (user.id === req.user.id) {
    return res.status(400).json({
      success: false,
      message: "You cannot delete your own account",
    });
  }

  // Use transaction to delete all associated data
  const result = await prisma.$transaction(async (prisma) => {
    // Get all listing IDs for this user
    const userListings = await prisma.listing.findMany({
      where: { host_id: id },
      select: { id: true },
    });

    const listingIds = userListings.map((l) => l.id);

    let deletedBookingsCount = 0;

    // Delete bookings on user's listings (as host)
    if (listingIds.length > 0) {
      const deletedHostBookings = await prisma.booking.deleteMany({
        where: {
          listing_id: {
            in: listingIds,
          },
        },
      });
      deletedBookingsCount += deletedHostBookings.count;
    }

    // Delete bookings where user is the guest
    const deletedGuestBookings = await prisma.booking.deleteMany({
      where: {
        user_id: id,
      },
    });
    deletedBookingsCount += deletedGuestBookings.count;

    // Delete user's listings
    const deletedListings = await prisma.listing.deleteMany({
      where: { host_id: id },
    });

    // Delete user's sessions
    await prisma.userSession.deleteMany({
      where: { user_id: id },
    });

    // Delete user's events
    await prisma.userEvent.deleteMany({
      where: { user_id: id },
    });

    // Delete user
    const deletedUser = await prisma.user.delete({
      where: { id },
    });

    return {
      user: deletedUser,
      listings: deletedListings.count,
      bookings: deletedBookingsCount,
    };
  });

  // Clear cache
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
// @desc    Get user's listings
// @route   GET /api/v1/admin/users/:id/listings
// @access  Private (Admin/Super Admin)
const getUserListings = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const listings = await prisma.listing.findMany({
    where: { host_id: id }, // Changed from user_id to host_id
    orderBy: { created_at: "desc" },
    include: {
      bookings: {
        where: { status: "confirmed" },
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

// @desc    Get user's bookings
// @route   GET /api/v1/admin/users/:id/bookings
// @access  Private (Admin/Super Admin)
const getUserBookings = asyncHandler(async (req, res) => {
  const { id } = req.params;

  // Bookings as guest
  const bookingsAsGuest = await prisma.booking.findMany({
    where: { user_id: id },
    orderBy: { created_at: "desc" },
    include: {
      listing: {
        select: {
          id: true,
          title: true,
          images: true,
          host_id: true, // Changed from user_id to host_id
        },
      },
    },
  });

  // Bookings on user's listings (as host)
  const bookingsAsHost = await prisma.booking.findMany({
    where: {
      listing: {
        host_id: id, // Changed from user_id to host_id
      },
    },
    orderBy: { created_at: "desc" },
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

// @desc    Get user's sessions
// @route   GET /api/v1/admin/users/:id/sessions
// @access  Private (Admin/Super Admin)
const getUserSessions = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const sessions = await prisma.userSession.findMany({
    where: { user_id: id },
    orderBy: { logged_in_at: "desc" },
  });

  res.status(200).json({
    success: true,
    sessions,
  });
});

// @desc    Get user's events
// @route   GET /api/v1/admin/users/:id/events
// @access  Private (Admin/Super Admin)
const getUserEvents = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const events = await prisma.userEvent.findMany({
    where: { user_id: id },
    orderBy: { created_at: "desc" },
    take: 100,
  });

  res.status(200).json({
    success: true,
    events,
  });
});

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
      id_images: true,
      host_details: true,
      _count: {
        select: {
          listings: true,
        },
      },
    },
    orderBy: { created_at: "asc" },
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
        ...user.host_details,
        verified: true,
        confirmed_at: now,
        expires_at: expiryDate,
      },
      status_reason: "Host account approved",
    },
  });

  // Send approval email
  await emailService.sendHostApprovalEmail(user.email, user.name);

  await redisHelpers.del(`user:${id}`);
  await redisHelpers.del("admin:stats");

  res.status(200).json({
    success: true,
    message: "Host approved successfully",
    user: {
      id: updatedUser.id,
      name: updatedUser.name,
      status: updatedUser.status,
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

  await prisma.user.update({
    where: { id },
    data: {
      status: "suspended",
      status_reason: reason || "Host application rejected",
    },
  });

  // Send rejection email
  await emailService.sendHostRejectionEmail(user.email, user.name, reason);

  await redisHelpers.del(`user:${id}`);
  await redisHelpers.del("admin:stats");

  res.status(200).json({
    success: true,
    message: "Host rejected successfully",
  });
});

// @desc    Get all listings
// @route   GET /api/v1/admin/listings
// @access  Private (Admin/Super Admin)
const getAllListings = asyncHandler(async (req, res) => {
  const { status, search, page = 1, limit = 20 } = req.query;

  const skip = (parseInt(page) - 1) * parseInt(limit);
  const take = parseInt(limit);

  const filter = {};
  if (status) filter.status = status;
  if (search) {
    filter.OR = [
      { title: { contains: search, mode: "insensitive" } },
      { description: { contains: search, mode: "insensitive" } },
      { location: { contains: search, mode: "insensitive" } },
    ];
  }

  const [listings, total] = await Promise.all([
    prisma.listing.findMany({
      where: filter,
      include: {
        host: {
          // Changed from 'user' to 'host'
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        bookings: {
          where: { status: "confirmed" },
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
      orderBy: { created_at: "desc" },
      skip,
      take,
    }),
    prisma.listing.count({ where: filter }),
  ]);

  res.status(200).json({
    success: true,
    listings,
    pagination: {
      page: parseInt(page),
      limit: parseInt(limit),
      total,
      pages: Math.ceil(total / parseInt(limit)),
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
      bookings: true,
    },
  });

  if (!listing) {
    return res.status(404).json({
      success: false,
      message: "Listing not found",
    });
  }

  // Use transaction to delete all associated data
  await prisma.$transaction(async (prisma) => {
    // Delete associated bookings
    await prisma.booking.deleteMany({
      where: { listing_id: id },
    });

    // Delete listing
    await prisma.listing.delete({
      where: { id },
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

  // Get new users by day for the last 30 days
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const newUsersByDay = await prisma.$queryRaw`
    SELECT DATE(created_at) as date, COUNT(*) as count
    FROM users
    WHERE created_at >= ${startDate ? new Date(startDate) : thirtyDaysAgo}
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
      SELECT DATE(created_at) as date, SUM(total_price) as revenue, COUNT(*) as bookings
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

module.exports = {
  getStats,
  getUsers,
  getUserById,
  updateUser,
  deleteUser,
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
};
