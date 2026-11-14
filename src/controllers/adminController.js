
// src/controllers/adminController.js

const { prisma } = require("../config/database");
const { Prisma } = require("@prisma/client");
const { redisHelpers } = require("../config/redis");
const { asyncHandler } = require("../middleware/errorHandler");
const emailService = require("../services/emailService");
const bcrypt = require("bcryptjs");

// ============================================================
// CONSTANTS & HELPERS
// ============================================================

const PUBLIC_ACCOUNT_TYPES = ["traveler", "host"];
const ADMIN_ACCOUNT_TYPES = ["admin", "super_admin"];

const VALID_STATUSES = [
  "active",
  "pending",
  "confirmed",
  "suspended",
  "banned",
];

const invalidateUserCache = async (userId) => {
  if (userId) {
    await redisHelpers.del(`user:${userId}`);
  }

  await redisHelpers.del("admin:stats");
};

const sendEmailSafely = async (label, callback) => {
  try {
    const result = await callback();

    if (result && result.success === false) {
      console.error(`${label} failed:`, result.error);
    }

    return result;
  } catch (error) {
    console.error(`${label} exception:`, error);
    return null;
  }
};

const parsePagination = (page, limit, defaultLimit = 20) => {
  const parsedPage = Number.parseInt(page, 10);
  const parsedLimit = Number.parseInt(limit, 10);

  const pageNumber =
    Number.isInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1;

  const limitNumber =
    Number.isInteger(parsedLimit) && parsedLimit > 0
      ? Math.min(parsedLimit, 100)
      : defaultLimit;

  return {
    page: pageNumber,
    limit: limitNumber,
    skip: (pageNumber - 1) * limitNumber,
    take: limitNumber,
  };
};

const normalizeAccountFilter = (value) => {
  if (!value) return null;

  const normalized = String(value).trim().toLowerCase();

  // Support older dashboard filters.
  if (normalized === "host") return { account_type: "host" };
  if (normalized === "traveler") return { account_type: "traveler" };
  if (normalized === "user") return { account_type: "traveler" };
  if (normalized === "admin") {
    return {
      account_type: "admin",
      role: "admin",
    };
  }
  if (normalized === "super_admin") {
    return {
      account_type: "super_admin",
      role: "super_admin",
    };
  }

  return null;
};

const getHostDetails = (value) => {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value;
  }

  return {};
};

const isValidDate = (value) => {
  if (!value) return false;

  const date = new Date(value);

  return !Number.isNaN(date.getTime());
};

const calculateHostExpiry = (months = 6) => {
  const now = new Date();
  const expiryDate = new Date(now);

  expiryDate.setMonth(expiryDate.getMonth() + months);

  return {
    now,
    expiryDate,
  };
};

const updateDocumentVerification = async (tx, userId, hostDetails) => {
  const documents = await tx.userIdDocument.findMany({
    where: { user_id: userId },
    select: {
      id: true,
      status: true,
    },
  });

  const allApproved =
    documents.length > 0 &&
    documents.every((document) => document.status === "approved");

  const hasRejected = documents.some(
    (document) => document.status === "rejected",
  );

  const nextHostDetails = {
    ...getHostDetails(hostDetails),
    id_verified: allApproved,
    id_verified_at: allApproved ? new Date() : null,
    id_rejected: !allApproved && hasRejected,
    id_rejection_reason: hasRejected
      ? "One or more identity documents were rejected"
      : null,
  };

  await tx.user.update({
    where: { id: userId },
    data: {
      host_details: nextHostDetails,
    },
  });

  return {
    allApproved,
    hasRejected,
    documentCount: documents.length,
  };
};

// ============================================================
// DASHBOARD STATISTICS
// ============================================================

// GET /api/v1/admin/stats
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
      where: {
        account_type: "traveler",
        role: "user",
        deleted_at: null,
      },
    }),

    prisma.user.count({
      where: {
        account_type: "host",
        role: "user",
        deleted_at: null,
      },
    }),

    prisma.user.count({
      where: {
        account_type: "admin",
        role: "admin",
        deleted_at: null,
      },
    }),

    prisma.user.count({
      where: {
        account_type: "super_admin",
        role: "super_admin",
        deleted_at: null,
      },
    }),

    prisma.listing.count({
      where: {
        is_active: true,
      },
    }),

    prisma.booking.count(),

    prisma.user.count({
      where: {
        account_type: "host",
        role: "user",
        status: "pending",
        deleted_at: null,
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

  return res.status(200).json({
    success: true,
    stats,
  });
});

// ============================================================
// USERS
// ============================================================

// GET /api/v1/admin/users
const getUsers = asyncHandler(async (req, res) => {
  const {
    role,
    account_type,
    status,
    search,
    page,
    limit,
  } = req.query;

  const pagination = parsePagination(page, limit, 50);

  const filter = {
    deleted_at: null,
  };

  const accountFilter = normalizeAccountFilter(account_type || role);

  if ((account_type || role) && !accountFilter) {
    return res.status(400).json({
      success: false,
      message: "Invalid account type filter",
    });
  }

  if (accountFilter) {
    Object.assign(filter, accountFilter);
  }

  if (status) {
    filter.status = String(status).trim();
  }

  if (search && String(search).trim()) {
    const searchTerm = String(search).trim();

    filter.OR = [
      {
        name: {
          contains: searchTerm,
          mode: "insensitive",
        },
      },
      {
        email: {
          contains: searchTerm,
          mode: "insensitive",
        },
      },
      {
        phone_number: {
          contains: searchTerm,
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
        account_type: true,
        role: true,
        status: true,
        status_reason: true,
        email_verified_at: true,
        created_at: true,
        updated_at: true,
        last_active: true,
        last_login_at: true,
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

      skip: pagination.skip,
      take: pagination.take,
    }),

    prisma.user.count({
      where: filter,
    }),
  ]);

  const [
    usersCount,
    hostsCount,
    adminsCount,
    superAdminsCount,
  ] = await Promise.all([
    prisma.user.count({
      where: {
        account_type: "traveler",
        role: "user",
        deleted_at: null,
      },
    }),

    prisma.user.count({
      where: {
        account_type: "host",
        role: "user",
        deleted_at: null,
      },
    }),

    prisma.user.count({
      where: {
        account_type: "admin",
        role: "admin",
        deleted_at: null,
      },
    }),

    prisma.user.count({
      where: {
        account_type: "super_admin",
        role: "super_admin",
        deleted_at: null,
      },
    }),
  ]);

  return res.status(200).json({
    success: true,
    users,

    usersByRole: {
      users: usersCount,
      travelers: usersCount,
      hosts: hostsCount,
      admins: adminsCount,
      super_admins: superAdminsCount,
    },

    pagination: {
      page: pagination.page,
      limit: pagination.limit,
      total,
      pages: Math.ceil(total / pagination.limit),
    },
  });
});

// GET /api/v1/admin/users/:id
const getUserById = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const user = await prisma.user.findFirst({
    where: {
      id,
      deleted_at: null,
    },

    select: {
      id: true,
      name: true,
      email: true,
      phone_number: true,
      account_type: true,
      role: true,
      status: true,
      status_reason: true,
      email_verified_at: true,
      profile_image: true,
      created_at: true,
      updated_at: true,
      last_active: true,
      last_login_at: true,
      host_expiry_date: true,
      host_details: true,
      user_details: true,

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

      host_subscription_payments: {
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
  });

  if (!user) {
    return res.status(404).json({
      success: false,
      message: "User not found",
    });
  }

  return res.status(200).json({
    success: true,
    user,
  });
});

// PUT /api/v1/admin/users/:id
const updateUser = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const {
    name,
    email,
    phone_number,
    role,
    account_type,
    status,
    status_reason,
  } = req.body;

  const existingUser = await prisma.user.findFirst({
    where: {
      id,
      deleted_at: null,
    },
  });

  if (!existingUser) {
    return res.status(404).json({
      success: false,
      message: "User not found",
    });
  }

  const isSuperAdmin = req.user.role === "super_admin";

  if (
    (existingUser.role === "super_admin" ||
      existingUser.account_type === "super_admin") &&
    !isSuperAdmin
  ) {
    return res.status(403).json({
      success: false,
      message: "Only super admins can modify super admin accounts",
    });
  }

  if (
    name !== undefined &&
    (typeof name !== "string" || !name.trim())
  ) {
    return res.status(400).json({
      success: false,
      message: "Name cannot be empty",
    });
  }

  if (
    email !== undefined &&
    (typeof email !== "string" || !email.trim())
  ) {
    return res.status(400).json({
      success: false,
      message: "A valid email is required",
    });
  }

  if (
    phone_number !== undefined &&
    phone_number !== null &&
    typeof phone_number !== "string"
  ) {
    return res.status(400).json({
      success: false,
      message: "Invalid phone number",
    });
  }

  if (status !== undefined && !VALID_STATUSES.includes(status)) {
    return res.status(400).json({
      success: false,
      message: "Invalid account status",
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
    updateData.phone_number = phone_number?.trim() || null;
  }

  if (status_reason !== undefined) {
    updateData.status_reason = status_reason?.trim() || null;
  }

  // Role/account type changes are restricted to super admins.
  if (role !== undefined || account_type !== undefined) {
    if (!isSuperAdmin) {
      return res.status(403).json({
        success: false,
        message: "Only super admins can change account types or roles",
      });
    }

    let nextAccountType = account_type || role;

    // Support the old dashboard sending role="host" or role="traveler".
    if (nextAccountType === "user") {
      nextAccountType = account_type || existingUser.account_type;
    }

    let nextRole;

    if (PUBLIC_ACCOUNT_TYPES.includes(nextAccountType)) {
      nextRole = "user";
    } else if (nextAccountType === "admin") {
      nextRole = "admin";
    } else if (nextAccountType === "super_admin") {
      nextRole = "super_admin";
    } else {
      return res.status(400).json({
        success: false,
        message: "Invalid account type",
      });
    }

    // Do not allow public account changes through inconsistent role values.
    if (
      role !== undefined &&
      role !== "user" &&
      role !== nextAccountType
    ) {
      return res.status(400).json({
        success: false,
        message: "Role and account type do not match",
      });
    }

    if (
      existingUser.role === "super_admin" &&
      nextRole !== "super_admin"
    ) {
      const superAdminCount = await prisma.user.count({
        where: {
          role: "super_admin",
          account_type: "super_admin",
          deleted_at: null,
        },
      });

      if (superAdminCount <= 1) {
        return res.status(400).json({
          success: false,
          message: "You cannot demote the last super admin",
        });
      }
    }

    updateData.account_type = nextAccountType;
    updateData.role = nextRole;
  }

  const nextRole = updateData.role || existingUser.role;
  const nextAccountType =
    updateData.account_type || existingUser.account_type;

  const securityChanged =
    nextRole !== existingUser.role ||
    nextAccountType !== existingUser.account_type ||
    (status !== undefined && status !== existingUser.status);

  if (securityChanged) {
    updateData.auth_version = {
      increment: 1,
    };
  }

  // Host-specific status transitions.
  const isHost =
    existingUser.account_type === "host" ||
    nextAccountType === "host";

  let hostEmailAction = null;

  if (isHost && status !== undefined) {
    const previousStatus = existingUser.status;
    const hostDetails = getHostDetails(existingUser.host_details);

    if (status === "confirmed" && previousStatus !== "confirmed") {
      const { now, expiryDate } = calculateHostExpiry(6);

      updateData.host_details = {
        ...hostDetails,
        confirmed_at: now,
        expires_at: expiryDate,
        verified: true,
      };

      updateData.host_expiry_date = expiryDate;

      hostEmailAction = async () =>
        emailService.sendHostConfirmationEmail(
          existingUser,
          expiryDate,
          Math.ceil(
            (expiryDate.getTime() - now.getTime()) /
              (1000 * 60 * 60 * 24),
          ),
        );
    } else if (status === "pending" && previousStatus !== "pending") {
      updateData.host_details = {
        ...hostDetails,
        verified: false,
        confirmed_at: null,
        expires_at: null,
        pending_since: new Date(),
      };

      updateData.host_expiry_date = null;

      const adminEmails = process.env.ADMIN_EMAILS
        ? process.env.ADMIN_EMAILS.split(",")
            .map((value) => value.trim())
            .filter(Boolean)
        : [];

      hostEmailAction = async () =>
        emailService.sendHostPendingApproval(
          existingUser,
          adminEmails,
        );
    } else if (
      status === "suspended" &&
      previousStatus !== "suspended"
    ) {
      hostEmailAction = async () =>
        emailService.sendHostSuspensionEmail(
          existingUser.email,
          existingUser.name,
          status_reason || "Violation of terms of service",
        );
    } else if (
      previousStatus === "suspended" &&
      status !== "suspended"
    ) {
      hostEmailAction = async () =>
        emailService.sendHostReactivationEmail(
          existingUser,
          status_reason || "Account has been reactivated",
        );
    }
  }

  if (status !== undefined) {
    updateData.status = status;
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
        account_type: true,
        role: true,
        status: true,
        status_reason: true,
        email_verified_at: true,
        created_at: true,
        updated_at: true,
        last_active: true,
        last_login_at: true,
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
      },
    });
  } catch (error) {
    if (error.code === "P2002") {
      return res.status(409).json({
        success: false,
        message: "Email or phone number is already being used",
      });
    }

    throw error;
  }

  if (hostEmailAction) {
    await sendEmailSafely(
      "Host status notification",
      hostEmailAction,
    );
  }

  await invalidateUserCache(id);

  return res.status(200).json({
    success: true,
    message: "User updated successfully",
    user: updatedUser,
  });
});

// ============================================================
// DELETE USER
// ============================================================

const deleteUserRecord = async (id, requestingUserId) => {
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findFirst({
      where: {
        id,
        deleted_at: null,
      },
    });

    if (!user) {
      const error = new Error("User not found");
      error.statusCode = 404;
      throw error;
    }

    if (user.id === requestingUserId) {
      const error = new Error("You cannot delete your own account");
      error.statusCode = 400;
      throw error;
    }

    if (
      user.role === "super_admin" ||
      user.account_type === "super_admin"
    ) {
      const superAdminCount = await tx.user.count({
        where: {
          role: "super_admin",
          account_type: "super_admin",
          deleted_at: null,
        },
      });

      if (superAdminCount <= 1) {
        const error = new Error("You cannot delete the last super admin");
        error.statusCode = 400;
        throw error;
      }
    }

    const listings = await tx.listing.findMany({
      where: {
        host_id: id,
      },
      select: {
        id: true,
      },
    });

    const listingIds = listings.map((listing) => listing.id);

    const listingBookings =
      listingIds.length > 0
        ? await tx.booking.findMany({
            where: {
              listing_id: {
                in: listingIds,
              },
            },
            select: {
              id: true,
            },
          })
        : [];

    const bookingIds = listingBookings.map((booking) => booking.id);

    // Remove block records linked to the user or their listings' bookings.
    await tx.hostBlockedUser.deleteMany({
      where: {
        OR: [
          { host_id: id },
          { user_id: id },
          ...(bookingIds.length > 0
            ? [{ booking_id: { in: bookingIds } }]
            : []),
        ],
      },
    });

    const deletedHostBookings =
      listingIds.length > 0
        ? await tx.booking.deleteMany({
            where: {
              listing_id: {
                in: listingIds,
              },
            },
          })
        : { count: 0 };

    const deletedGuestBookings = await tx.booking.deleteMany({
      where: {
        user_id: id,
      },
    });

    const deletedListings = await tx.listing.deleteMany({
      where: {
        host_id: id,
      },
    });

    // Explicitly remove dependent records before deleting the user.
    await tx.userIdDocument.deleteMany({
      where: {
        user_id: id,
      },
    });

    await tx.userSession.deleteMany({
      where: {
        user_id: id,
      },
    });

    await tx.userEvent.deleteMany({
      where: {
        user_id: id,
      },
    });

    await tx.hostSubscriptionPayment.deleteMany({
      where: {
        host_id: id,
      },
    });

    await tx.user.delete({
      where: {
        id,
      },
    });

    return {
      listings: deletedListings.count,
      bookings:
        deletedHostBookings.count + deletedGuestBookings.count,
    };
  });
};

// DELETE /api/v1/admin/users/:id
const deleteUser = asyncHandler(async (req, res) => {
  if (req.user.role !== "super_admin") {
    return res.status(403).json({
      success: false,
      message: "Only super admins can delete users",
    });
  }

  const { id } = req.params;

  let result;

  try {
    result = await deleteUserRecord(id, req.user.id);
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        success: false,
        message: error.message,
      });
    }

    throw error;
  }

  await invalidateUserCache(id);

  return res.status(200).json({
    success: true,
    message: "User deleted successfully",
    deletedCount: {
      user: 1,
      listings: result.listings,
      bookings: result.bookings,
    },
  });
});

// Backward-compatible dashboard deletion handler.
const deleteDashboardUser = deleteUser;

// ============================================================
// USER LISTINGS
// ============================================================

// GET /api/v1/admin/users/:id/listings
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

  return res.status(200).json({
    success: true,
    listings,
  });
});

// ============================================================
// USER BOOKINGS
// ============================================================

// GET /api/v1/admin/users/:id/bookings
const getUserBookings = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const [bookingsAsGuest, bookingsAsHost] = await Promise.all([
    prisma.booking.findMany({
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
    }),

    prisma.booking.findMany({
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
    }),
  ]);

  return res.status(200).json({
    success: true,
    bookingsAsGuest,
    bookingsAsHost,
  });
});

// ============================================================
// USER SESSIONS
// ============================================================

// GET /api/v1/admin/users/:id/sessions
const getUserSessions = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const sessions = await prisma.userSession.findMany({
    where: {
      user_id: id,
    },

    select: {
      id: true,
      user_id: true,
      device: true,
      browser: true,
      os: true,
      ip_address: true,
      user_agent: true,
      logged_in_at: true,
      logged_out_at: true,
      is_active: true,
      expires_at: true,
    },

    orderBy: {
      logged_in_at: "desc",
    },
  });

  return res.status(200).json({
    success: true,
    sessions,
  });
});

// ============================================================
// USER EVENTS
// ============================================================

// GET /api/v1/admin/users/:id/events
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

  return res.status(200).json({
    success: true,
    events,
  });
});

// ============================================================
// HOSTS
// ============================================================

// GET /api/v1/admin/hosts/pending
const getPendingHosts = asyncHandler(async (req, res) => {
  const pendingHosts = await prisma.user.findMany({
    where: {
      account_type: "host",
      role: "user",
      status: "pending",
      deleted_at: null,
    },

    select: {
      id: true,
      name: true,
      email: true,
      phone_number: true,
      account_type: true,
      role: true,
      status: true,
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

  return res.status(200).json({
    success: true,
    pendingHosts,
  });
});

// PUT /api/v1/admin/hosts/:id/approve
const approveHost = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const user = await prisma.user.findFirst({
    where: {
      id,
      deleted_at: null,
    },
  });

  if (!user) {
    return res.status(404).json({
      success: false,
      message: "User not found",
    });
  }

  if (user.account_type !== "host" || user.role !== "user") {
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

  const { now, expiryDate } = calculateHostExpiry(6);

  const updatedUser = await prisma.user.update({
    where: { id },

    data: {
      status: "confirmed",
      status_reason: "Host account approved",
      host_expiry_date: expiryDate,

      auth_version: {
        increment: 1,
      },

      host_details: {
        ...getHostDetails(user.host_details),
        verified: true,
        confirmed_at: now,
        expires_at: expiryDate,
        rejected: false,
        rejection_reason: null,
      },
    },

    select: {
      id: true,
      name: true,
      email: true,
      account_type: true,
      role: true,
      status: true,
      host_expiry_date: true,
      host_details: true,
    },
  });

  await sendEmailSafely("Host approval email", () =>
    emailService.sendHostApprovalEmail(user.email, user.name),
  );

  await invalidateUserCache(id);

  return res.status(200).json({
    success: true,
    message: "Host approved successfully",
    user: updatedUser,
  });
});

// PUT /api/v1/admin/hosts/:id/reject
const rejectHost = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { reason } = req.body;

  const user = await prisma.user.findFirst({
    where: {
      id,
      deleted_at: null,
    },
  });

  if (!user) {
    return res.status(404).json({
      success: false,
      message: "User not found",
    });
  }

  if (user.account_type !== "host" || user.role !== "user") {
    return res.status(400).json({
      success: false,
      message: "User is not a host",
    });
  }

  const rejectionReason =
    typeof reason === "string" && reason.trim()
      ? reason.trim()
      : "Host application rejected";

  await prisma.user.update({
    where: { id },

    data: {
      status: "suspended",
      status_reason: rejectionReason,

      auth_version: {
        increment: 1,
      },

      host_details: {
        ...getHostDetails(user.host_details),
        verified: false,
        rejected: true,
        rejection_reason: rejectionReason,
      },
    },
  });

  await sendEmailSafely("Host rejection email", () =>
    emailService.sendHostRejectionEmail(
      user.email,
      user.name,
      rejectionReason,
    ),
  );

  await invalidateUserCache(id);

  return res.status(200).json({
    success: true,
    message: "Host rejected successfully",
  });
});

// ============================================================
// LISTINGS
// ============================================================

// GET /api/v1/admin/listings
const getAllListings = asyncHandler(async (req, res) => {
  const { status, search, page, limit } = req.query;

  const pagination = parsePagination(page, limit, 20);

  const filter = {};

  if (status) {
    filter.status = String(status).trim();
  }

  if (search && String(search).trim()) {
    const searchTerm = String(search).trim();

    filter.OR = [
      {
        title: {
          contains: searchTerm,
          mode: "insensitive",
        },
      },
      {
        description: {
          contains: searchTerm,
          mode: "insensitive",
        },
      },
      {
        location: {
          contains: searchTerm,
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
            account_type: true,
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

      skip: pagination.skip,
      take: pagination.take,
    }),

    prisma.listing.count({
      where: filter,
    }),
  ]);

  return res.status(200).json({
    success: true,
    listings,

    pagination: {
      page: pagination.page,
      limit: pagination.limit,
      total,
      pages: Math.ceil(total / pagination.limit),
    },
  });
});

// DELETE /api/v1/admin/listings/:id
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

  const bookingIds = listing.bookings.map((booking) => booking.id);

  await prisma.$transaction(async (tx) => {
    if (bookingIds.length > 0) {
      await tx.hostBlockedUser.deleteMany({
        where: {
          booking_id: {
            in: bookingIds,
          },
        },
      });
    }

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

  return res.status(200).json({
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

// GET /api/v1/admin/reports/users
const getUserReport = asyncHandler(async (req, res) => {
  const { startDate, endDate } = req.query;

  if (
    (startDate && !isValidDate(startDate)) ||
    (endDate && !isValidDate(endDate))
  ) {
    return res.status(400).json({
      success: false,
      message: "Invalid report date",
    });
  }

  const dateFilter = {};

  if (startDate) {
    dateFilter.gte = new Date(startDate);
  }

  if (endDate) {
    dateFilter.lte = new Date(endDate);
  }

  if (
    startDate &&
    endDate &&
    new Date(startDate) > new Date(endDate)
  ) {
    return res.status(400).json({
      success: false,
      message: "Start date must be before end date",
    });
  }

  const [breakdown, totalUsers] = await Promise.all([
    prisma.user.groupBy({
      by: ["account_type", "role", "status"],

      _count: {
        id: true,
      },

      where: {
        created_at: dateFilter,
        deleted_at: null,
      },
    }),

    prisma.user.count({
      where: {
        created_at: dateFilter,
        deleted_at: null,
      },
    }),
  ]);

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const reportStartDate = startDate
    ? new Date(startDate)
    : thirtyDaysAgo;

  const endCondition = endDate
    ? Prisma.sql`AND created_at <= ${new Date(endDate)}`
    : Prisma.empty;

  const dailyRows = await prisma.$queryRaw(
    Prisma.sql`
      SELECT
        DATE(created_at) AS date,
        COUNT(*)::int AS count
      FROM users
      WHERE created_at >= ${reportStartDate}
        AND deleted_at IS NULL
        ${endCondition}
      GROUP BY DATE(created_at)
      ORDER BY DATE(created_at) DESC
      LIMIT 30
    `,
  );

  const newUsersByDay = dailyRows.map((row) => ({
    ...row,
    count: Number(row.count),
  }));

  return res.status(200).json({
    success: true,

    data: {
      totalUsers,
      breakdown,
      newUsersByDay,
    },
  });
});

// ============================================================
// REVENUE REPORT
// ============================================================

// GET /api/v1/admin/reports/revenue
const getRevenueReport = asyncHandler(async (req, res) => {
  const { period = "month" } = req.query;

  const now = new Date();
  let startDate;

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
      return res.status(400).json({
        success: false,
        message: "Period must be week, month, or year",
      });
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
        DATE(created_at) AS date,
        SUM(total_price) AS revenue,
        COUNT(*)::int AS bookings
      FROM bookings
      WHERE status = 'confirmed'
        AND created_at >= ${startDate}
      GROUP BY DATE(created_at)
      ORDER BY DATE(created_at) DESC
    `,
  ]);

  return res.status(200).json({
    success: true,

    data: {
      totalRevenue: revenue._sum.total_price || 0,
      totalBookings: revenue._count.id || 0,
      period,

      revenueByDay: revenueByDay.map((row) => ({
        ...row,
        bookings: Number(row.bookings),
      })),
    },
  });
});

// ============================================================
// SUBSCRIPTION PAYMENTS
// ============================================================

// GET /api/v1/admin/payments
const getPayments = asyncHandler(async (req, res) => {
  const { status, host_id, page, limit } = req.query;

  const pagination = parsePagination(page, limit, 20);

  const where = {};

  if (status) {
    where.status = String(status).trim();
  }

  if (host_id) {
    where.host_id = String(host_id).trim();
  }

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
            account_type: true,
            role: true,
            status: true,
          },
        },
      },

      orderBy: {
        created_at: "desc",
      },

      skip: pagination.skip,
      take: pagination.take,
    }),

    prisma.hostSubscriptionPayment.count({
      where,
    }),
  ]);

  return res.status(200).json({
    success: true,
    data: payments,

    pagination: {
      page: pagination.page,
      limit: pagination.limit,
      total,
      pages: Math.ceil(total / pagination.limit),
    },
  });
});

// GET /api/v1/admin/payments/:paymentId
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
          account_type: true,
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

  return res.status(200).json({
    success: true,
    data: payment,
  });
});

// PUT /api/v1/admin/payments/:paymentId/approve
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

  if (
    !payment.host ||
    payment.host.account_type !== "host" ||
    payment.host.role !== "user"
  ) {
    return res.status(400).json({
      success: false,
      message: "Payment does not belong to a valid host account",
    });
  }

  const { now, expiryDate } = calculateHostExpiry(6);

  const result = await prisma.$transaction(async (tx) => {
    const updatedPayment =
      await tx.hostSubscriptionPayment.update({
        where: {
          id: paymentId,
        },

        data: {
          status: "approved",
          paid_at: now,
          period_start: now,
          period_end: expiryDate,
          notes: notes?.trim() || payment.notes,
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

    await tx.user.update({
      where: {
        id: payment.host_id,
      },

      data: {
        host_details: {
          ...getHostDetails(payment.host.host_details),
          payment_verified: true,
          payment_verified_at: now,
          payment_rejected: false,
          payment_rejection_reason: null,
        },

        host_expiry_date: expiryDate,
      },
    });

    return updatedPayment;
  });

  await sendEmailSafely("Host payment approval email", () =>
    emailService.sendHostPaymentApprovedEmail(
      payment.host,
      result,
      expiryDate,
    ),
  );

  await invalidateUserCache(payment.host_id);

  return res.status(200).json({
    success: true,
    message: "Payment approved successfully",
    data: result,
  });
});

// PUT /api/v1/admin/payments/:paymentId/reject
const rejectPayment = asyncHandler(async (req, res) => {
  const { paymentId } = req.params;
  const { reason } = req.body;

  if (typeof reason !== "string" || !reason.trim()) {
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

  if (!payment.host) {
    return res.status(400).json({
      success: false,
      message: "Payment host was not found",
    });
  }

  const rejectionReason = reason.trim();

  const result = await prisma.$transaction(async (tx) => {
    const updatedPayment =
      await tx.hostSubscriptionPayment.update({
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

    await tx.user.update({
      where: {
        id: payment.host_id,
      },

      data: {
        host_details: {
          ...getHostDetails(payment.host.host_details),
          payment_verified: false,
          payment_verified_at: null,
          payment_rejected: true,
          payment_rejection_reason: rejectionReason,
        },
      },
    });

    return updatedPayment;
  });

  await sendEmailSafely("Host payment rejection email", () =>
    emailService.sendHostPaymentRejectedEmail(
      payment.host,
      result,
      rejectionReason,
    ),
  );

  await invalidateUserCache(payment.host_id);

  return res.status(200).json({
    success: true,
    message: "Payment rejected successfully",
    data: result,
  });
});

// GET /api/v1/admin/payments/stats
const getPaymentStats = asyncHandler(async (req, res) => {
  const [total, pending, approved, rejected, approvedPayments] =
    await Promise.all([
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

      prisma.hostSubscriptionPayment.aggregate({
        where: {
          status: "approved",
        },

        _sum: {
          amount: true,
        },
      }),
    ]);

  return res.status(200).json({
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

// PUT /api/v1/admin/doc/:documentId/approve
const approveUserId = asyncHandler(async (req, res) => {
  const { documentId } = req.params;
  const { notes } = req.body;

  const document = await prisma.userIdDocument.findUnique({
    where: {
      id: documentId,
    },

    include: {
      user: true,
    },
  });

  if (!document || !document.user) {
    return res.status(404).json({
      success: false,
      message: "Document or associated user not found",
    });
  }

  if (document.status === "approved") {
    return res.status(400).json({
      success: false,
      message: "Document is already approved",
    });
  }

  const now = new Date();

  const result = await prisma.$transaction(async (tx) => {
    const updatedDocument = await tx.userIdDocument.update({
      where: {
        id: documentId,
      },

      data: {
        status: "approved",
        rejection_reason: null,
        admin_notes: notes?.trim() || null,
        reviewed_at: now,
        reviewed_by: req.user.id,
      },
    });

    const verification = await updateDocumentVerification(
      tx,
      document.user.id,
      document.user.host_details,
    );

    return {
      document: updatedDocument,
      verification,
    };
  });

  if (result.verification.allApproved) {
    await sendEmailSafely("Host ID approval email", () =>
      emailService.sendHostIdApprovedEmail(
        document.user,
        notes || "Your ID documents have been verified and approved.",
      ),
    );
  } else {
    await sendEmailSafely("ID document approval email", () =>
      emailService.sendHostIdDocumentApprovedEmail(
        document.user,
        document.document_type || "ID Document",
        document.side || "",
        notes || "Your document has been approved.",
      ),
    );
  }

  await invalidateUserCache(document.user.id);

  return res.status(200).json({
    success: true,
    message: "Document approved successfully",
    data: result.document,
    verification: result.verification,
  });
});

// PUT /api/v1/admin/doc/:documentId/reject
const rejectUserId = asyncHandler(async (req, res) => {
  const { documentId } = req.params;
  const { reason } = req.body;

  if (typeof reason !== "string" || !reason.trim()) {
    return res.status(400).json({
      success: false,
      message: "Rejection reason is required",
    });
  }

  const document = await prisma.userIdDocument.findUnique({
    where: {
      id: documentId,
    },

    include: {
      user: true,
    },
  });

  if (!document || !document.user) {
    return res.status(404).json({
      success: false,
      message: "Document or associated user not found",
    });
  }

  if (document.status === "rejected") {
    return res.status(400).json({
      success: false,
      message: "Document is already rejected",
    });
  }

  const rejectionReason = reason.trim();

  const result = await prisma.$transaction(async (tx) => {
    const updatedDocument = await tx.userIdDocument.update({
      where: {
        id: documentId,
      },

      data: {
        status: "rejected",
        rejection_reason: rejectionReason,
        admin_notes: null,
        reviewed_at: new Date(),
        reviewed_by: req.user.id,
      },
    });

    const verification = await updateDocumentVerification(
      tx,
      document.user.id,
      document.user.host_details,
    );

    return {
      document: updatedDocument,
      verification,
    };
  });

  await sendEmailSafely("ID document rejection email", () =>
    emailService.sendHostIdRejectedEmail(
      document.user,
      rejectionReason,
    ),
  );

  await invalidateUserCache(document.user.id);

  return res.status(200).json({
    success: true,
    message: "Document rejected successfully",
    data: result.document,
    verification: result.verification,
  });
});

// PUT /api/v1/admin/doc/:documentId/pending
const setUserIdPending = asyncHandler(async (req, res) => {
  const { documentId } = req.params;
  const { reason } = req.body;

  const document = await prisma.userIdDocument.findUnique({
    where: {
      id: documentId,
    },

    include: {
      user: true,
    },
  });

  if (!document || !document.user) {
    return res.status(404).json({
      success: false,
      message: "Document or associated user not found",
    });
  }

  if (document.status === "pending") {
    return res.status(400).json({
      success: false,
      message: "Document is already pending",
    });
  }

  const result = await prisma.$transaction(async (tx) => {
    const updatedDocument = await tx.userIdDocument.update({
      where: {
        id: documentId,
      },

      data: {
        status: "pending",
        rejection_reason: null,
        admin_notes: reason?.trim() || null,
        reviewed_at: null,
        reviewed_by: null,
      },
    });

    const verification = await updateDocumentVerification(
      tx,
      document.user.id,
      document.user.host_details,
    );

    return {
      document: updatedDocument,
      verification,
    };
  });

  await invalidateUserCache(document.user.id);

  return res.status(200).json({
    success: true,
    message: "Document status changed to pending",
    data: result.document,
    verification: result.verification,
  });
});

// ============================================================
// CREATE ADMIN
// ============================================================

// POST /api/v1/admin/user/createAdmin
const createAdmin = asyncHandler(async (req, res) => {
  if (req.user.role !== "super_admin") {
    return res.status(403).json({
      success: false,
      message: "Only super admins can create admin accounts",
    });
  }

  const {
    name,
    email,
    password,
    phone_number,
    role = "admin",
  } = req.body;

  if (
    typeof name !== "string" ||
    !name.trim() ||
    typeof email !== "string" ||
    !email.trim() ||
    typeof password !== "string" ||
    !password ||
    typeof phone_number !== "string" ||
    !phone_number.trim()
  ) {
    return res.status(400).json({
      success: false,
      message: "Name, email, password and phone number are required",
    });
  }

  if (password.length < 12) {
    return res.status(400).json({
      success: false,
      message: "Password must be at least 12 characters",
    });
  }

  if (!ADMIN_ACCOUNT_TYPES.includes(role)) {
    return res.status(400).json({
      success: false,
      message: "Invalid admin role",
    });
  }

  const normalizedEmail = email.toLowerCase().trim();

  const existingUser = await prisma.user.findUnique({
    where: {
      email: normalizedEmail,
    },
    select: {
      id: true,
    },
  });

  if (existingUser) {
    return res.status(409).json({
      success: false,
      message: "An account already exists with this email",
    });
  }

  const passwordHash = await bcrypt.hash(password, 12);

  let user;

  try {
    user = await prisma.user.create({
      data: {
        name: name.trim(),
        email: normalizedEmail,
        password_hash: passwordHash,
        phone_number: phone_number.trim(),

        // Admin accounts must have matching role and account type.
        account_type: role,
        role,

        status: "confirmed",
        email_verified_at: new Date(),

        user_details: {
          preferences: {},
          bookings: [],
        },
      },

      select: {
        id: true,
        name: true,
        email: true,
        phone_number: true,
        account_type: true,
        role: true,
        status: true,
        email_verified_at: true,
        created_at: true,
      },
    });
  } catch (error) {
    if (error.code === "P2002") {
      return res.status(409).json({
        success: false,
        message: "An account already exists with this email or phone number",
      });
    }

    throw error;
  }

  await sendEmailSafely("Admin welcome email", () =>
    emailService.sendAdminWelcomeEmail(
      user.email,
      user.name,
      role,
    ),
  );

  await redisHelpers.del("admin:stats");

  return res.status(201).json({
    success: true,
    message: `${role} created successfully`,
    user,
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
