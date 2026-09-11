const { prisma } = require("../config/database");
const { asyncHandler } = require("../middleware/errorHandler");

// ============================================================
// GET SIMPLE PLATFORM STATISTICS
// GET /api/v1/stats/simple
// ============================================================
const getSimpleStats = asyncHandler(async (req, res) => {
  try {
    const result = await prisma.$queryRaw`
      SELECT
        (SELECT COUNT(*) FROM users) AS total_users,

        (
          SELECT COUNT(*)
          FROM users
          WHERE role = 'host'
        ) AS total_hosts,

        (
          SELECT COUNT(*)
          FROM users
          WHERE role = 'host'
            AND status = 'confirmed'
            AND EXISTS (
              SELECT 1
              FROM listings
              WHERE listings.host_id = users.id
                AND listings.status = 'active'
            )
        ) AS active_hosts,

        (
          SELECT COUNT(*)
          FROM listings
          WHERE status = 'active'
        ) AS total_listings,

        (
          SELECT COUNT(*)
          FROM bookings
        ) AS total_bookings,

        (
          SELECT COUNT(*)
          FROM bookings
          WHERE status = 'confirmed'
        ) AS confirmed_bookings,

        (
          SELECT COUNT(DISTINCT user_id)
          FROM bookings
          WHERE status = 'confirmed'
        ) AS total_travelers
    `;

    const row = result[0];

    return res.status(200).json({
      success: true,
      data: {
        total_users: Number(row.total_users) || 0,
        total_hosts: Number(row.total_hosts) || 0,
        active_hosts: Number(row.active_hosts) || 0,
        total_listings: Number(row.total_listings) || 0,
        total_bookings: Number(row.total_bookings) || 0,
        confirmed_bookings: Number(row.confirmed_bookings) || 0,
        total_travelers: Number(row.total_travelers) || 0,
      },
    });
  } catch (error) {
    console.error("❌ Error fetching simple stats:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch statistics",
      error:
        process.env.NODE_ENV === "development"
          ? error.message
          : undefined,
    });
  }
});

module.exports = {
  getSimpleStats,
};