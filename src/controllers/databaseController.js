const { prisma } = require("../config/database");
const { asyncHandler } = require("../middleware/errorHandler");

// Get database overview
const getDatabaseOverview = asyncHandler(async (req, res) => {
  const [
    users,
    userIdDocuments,
    userSessions,
    userEvents,
    listings,
    bookings,
    hostBlockedUsers,
    hostSubscriptionPayments,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.userIdDocument.count(),
    prisma.userSession.count(),
    prisma.userEvent.count(),
    prisma.listing.count(),
    prisma.booking.count(),
    prisma.hostBlockedUser.count(),
    prisma.hostSubscriptionPayment.count(),
  ]);

  res.json({
    success: true,
    data: {
      tables: [
        {
          name: "User",
          count: users,
        },
        {
          name: "UserIdDocument",
          count: userIdDocuments,
        },
        {
          name: "UserSession",
          count: userSessions,
        },
        {
          name: "UserEvent",
          count: userEvents,
        },
        {
          name: "Listing",
          count: listings,
        },
        {
          name: "Booking",
          count: bookings,
        },
        {
          name: "HostBlockedUser",
          count: hostBlockedUsers,
        },
        {
          name: "HostSubscriptionPayment",
          count: hostSubscriptionPayments,
        },
      ],
    },
  });
});

// Get records from a table
const getDatabaseTable = asyncHandler(async (req, res) => {
  const { table } = req.params;

  const allowedTables = {
    User: () =>
      prisma.user.findMany({
        orderBy: {
          created_at: "desc",
        },
      }),

    UserIdDocument: () =>
      prisma.userIdDocument.findMany({
        orderBy: {
          created_at: "desc",
        },
      }),

    UserSession: () =>
      prisma.userSession.findMany({
        orderBy: {
          logged_in_at: "desc",
        },
      }),

    UserEvent: () =>
      prisma.userEvent.findMany({
        orderBy: {
          created_at: "desc",
        },
      }),

    Listing: () =>
      prisma.listing.findMany({
        orderBy: {
          created_at: "desc",
        },
      }),

    Booking: () =>
      prisma.booking.findMany({
        orderBy: {
          created_at: "desc",
        },
      }),

    HostBlockedUser: () =>
      prisma.hostBlockedUser.findMany({
        orderBy: {
          created_at: "desc",
        },
      }),

    HostSubscriptionPayment: () =>
      prisma.hostSubscriptionPayment.findMany({
        orderBy: {
          created_at: "desc",
        },
      }),
  };

  if (!allowedTables[table]) {
    return res.status(400).json({
      success: false,
      message: "Invalid table name",
    });
  }

  const data = await allowedTables[table]();

  res.json({
    success: true,
    table,
    count: data.length,
    data,
  });
});

module.exports = {
  getDatabaseOverview,
  getDatabaseTable,
};