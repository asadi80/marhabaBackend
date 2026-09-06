
// src/controllers/bookingController.js

const { prisma } = require('../config/database');
const { redisHelpers } = require('../config/redis');
const { asyncHandler } = require('../middleware/errorHandler');

const {
  paginate,
  paginationMeta,
  calculateBookingPrice,
  datesOverlap,
} = require('../utils/helpers');

const emailService = require('../services/emailService');

// @desc    Create booking
// @route   POST /api/v1/bookings
// @access  Private
const createBooking = asyncHandler(async (req, res) => {
  const { listing_id, check_in, check_out, guests = 1 } = req.body;

  // Find listing
  const listing = await prisma.listing.findUnique({
    where: { id: listing_id },
    include: {
      host: {
        select: {
          id: true,
          name: true,
          email: true,
          phone_number: true,
        },
      },
      bookings: {
        where: {
          status: {
            in: ['pending', 'confirmed', 'checked_in'],
          },
        },
        select: {
          check_in: true,
          check_out: true,
          status: true,
        },
      },
    },
  });

  if (!listing) {
    return res.status(404).json({
      success: false,
      message: 'Listing not found',
    });
  }

  // Check listing availability
  if (!listing.is_active || listing.status !== 'active') {
    return res.status(400).json({
      success: false,
      message: 'Listing is not available',
    });
  }

  // Prevent host from booking own listing
  if (listing.host_id === req.user.id) {
    return res.status(400).json({
      success: false,
      message: 'You cannot book your own listing',
    });
  }

  // Validate dates
  const checkInDate = new Date(check_in);
  const checkOutDate = new Date(check_out);

  if (Number.isNaN(checkInDate.getTime()) || Number.isNaN(checkOutDate.getTime())) {
    return res.status(400).json({
      success: false,
      message: 'Invalid check-in or check-out date',
    });
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (checkInDate < today) {
    return res.status(400).json({
      success: false,
      message: 'Check-in date must be today or future',
    });
  }

  if (checkOutDate <= checkInDate) {
    return res.status(400).json({
      success: false,
      message: 'Check-out must be after check-in',
    });
  }

  // Check existing bookings
  const isAvailable = listing.bookings.every((booking) => {
    return !datesOverlap(
      checkInDate,
      checkOutDate,
      new Date(booking.check_in),
      new Date(booking.check_out)
    );
  });

  if (!isAvailable) {
    return res.status(400).json({
      success: false,
      message: 'Selected dates are not available',
    });
  }

  // Check blocked dates
  const blockedDates = listing.blocked_dates || [];

  const isBlocked = blockedDates.some((block) => {
    return datesOverlap(
      checkInDate,
      checkOutDate,
      new Date(block.start),
      new Date(block.end)
    );
  });

  if (isBlocked) {
    return res.status(400).json({
      success: false,
      message: 'Selected dates are blocked by the host',
    });
  }

  // Calculate booking price
  // This is only the booking value/price.
  // No payment is processed by this application.
  const totalPrice = calculateBookingPrice(
    parseFloat(listing.price),
    checkInDate,
    checkOutDate,
    guests
  );

  // Create booking
  const booking = await prisma.booking.create({
    data: {
      listing_id,
      user_id: req.user.id,
      check_in: checkInDate,
      check_out: checkOutDate,
      total_price: totalPrice,
      guests,
      status: 'pending',
    },

    include: {
      listing: {
        include: {
          host: {
            select: {
              id: true,
              name: true,
              email: true,
              phone_number: true,
            },
          },
        },
      },

      user: {
        select: {
          id: true,
          name: true,
          email: true,
          phone_number: true,
        },
      },
    },
  });

  // Send booking notification email
  try {
    await emailService.sendBookingConfirmationEmail(
      req.user.email,
      req.user.name,
      {
        id: booking.id,
        listingTitle: listing.title,
        checkIn: checkInDate,
        checkOut: checkOutDate,
        guests,
        totalPrice,
      }
    );
  } catch (error) {
    console.error(
      'Failed to send booking confirmation email:',
      error
    );
  }

  // Clear booking cache
  await redisHelpers.deletePattern('bookings:*');

  return res.status(201).json({
    success: true,
    message: 'Booking created successfully',
    data: booking,
  });
});


// @desc    Get all bookings for current user
// @route   GET /api/v1/bookings/my-booking
// @access  Private
const getMyBookings = asyncHandler(async (req, res) => {
  const { page, limit } = paginate(
    req.query.page,
    req.query.limit
  );

  const { status, upcoming } = req.query;

  // Ensure user exists
  if (!req.user || !req.user.id) {
    return res.status(401).json({
      success: false,
      message: 'User not authenticated',
    });
  }

  const where = {
    user_id: req.user.id,
  };

  // Status filter
  if (status) {
    const validStatuses = [
      'pending',
      'confirmed',
      'checked_in',
      'checked_out',
      'cancelled',
      'no_show',
    ];

    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status parameter',
      });
    }

    where.status = status;
  }

  // Upcoming bookings
  if (upcoming === 'true') {
    where.check_in = {
      gte: new Date(),
    };

    where.status = {
      in: ['confirmed', 'pending'],
    };
  }

  try {
    const cacheKey = `bookings:user:${req.user.id}:${JSON.stringify({
      where,
      skip: page,
      take: limit,
    })}`;

    const cachedBookings = await redisHelpers.get(cacheKey);

    if (cachedBookings) {
      return res.status(200).json({
        success: true,
        ...cachedBookings,
      });
    }

    const [bookings, total] = await Promise.all([
      prisma.booking.findMany({
        where,
        orderBy: {
          created_at: 'desc',
        },
        skip: paginate.skip,
        take: paginate.take,

        include: {
          listing: {
            include: {
              host: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                  phone_number: true,
                },
              },
            },
          },

          user: {
            select: {
              id: true,
              name: true,
              email: true,
              phone_number: true,
            },
          },
        },
      }),

      prisma.booking.count({
        where,
      }),
    ]);

    const meta = paginationMeta(
      total,
      paginate.page,
      paginate.limit
    );

    const result = {
      data: bookings,
      meta,
    };

    // Cache for 5 minutes
    await redisHelpers.set(
      cacheKey,
      result,
      300
    );

    return res.status(200).json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error(
      'Error fetching bookings:',
      error
    );

    return res.status(200).json({
      success: true,
      data: [],
      meta: {
        total: 0,
        page: paginate.page || 1,
        limit: paginate.limit || 10,
        totalPages: 0,
      },
    });
  }
});


// @desc    Get bookings for host's listings
// @route   GET /api/v1/bookings/host
// @access  Private (Host only)
const getHostBookings = asyncHandler(async (req, res) => {
  const { page, limit } = paginate(
    req.query.page,
    req.query.limit
  );

  const { status, listing_id } = req.query;

  const where = {
    listing: {
      host_id: req.user.id,
    },
  };

  if (status) {
    where.status = status;
  }

  if (listing_id) {
    where.listing_id = listing_id;
  }

  const [bookings, total] = await Promise.all([
    prisma.booking.findMany({
      where,

      orderBy: {
        created_at: 'desc',
      },

      skip: paginate.skip,
      take: paginate.take,

      include: {
        listing: {
          select: {
            id: true,
            title: true,
            location: true,
            price: true,
          },
        },

        user: {
          select: {
            id: true,
            name: true,
            email: true,
            phone_number: true,
          },
        },
      },
    }),

    prisma.booking.count({
      where,
    }),
  ]);

  const meta = paginationMeta(
    total,
    paginate.page,
    paginate.limit
  );

  return res.status(200).json({
    success: true,
    data: bookings,
    meta,
  });
});


// @desc    Get single booking
// @route   GET /api/v1/bookings/:id
// @access  Private
const getBookingById = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const booking = await prisma.booking.findUnique({
    where: { id },

    include: {
      listing: {
        include: {
          host: {
            select: {
              id: true,
              name: true,
              email: true,
              phone_number: true,
              host_details: true,
            },
          },
        },
      },

      user: {
        select: {
          id: true,
          name: true,
          email: true,
          phone_number: true,
        },
      },
    },
  });

  if (!booking) {
    return res.status(404).json({
      success: false,
      message: 'Booking not found',
    });
  }

  // Authorization
  const isAuthorized =
    booking.user_id === req.user.id ||
    booking.listing.host_id === req.user.id ||
    req.user.role === 'admin' ||
    req.user.role === 'super_admin';

  if (!isAuthorized) {
    return res.status(403).json({
      success: false,
      message: 'Not authorized to view this booking',
    });
  }

  return res.status(200).json({
    success: true,
    data: booking,
  });
});


// @desc    Update booking status
// @route   PUT /api/v1/bookings/:id/status
// @access  Private
const updateBookingStatus = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { status, reason } = req.body;

  const booking = await prisma.booking.findUnique({
    where: { id },

    include: {
      listing: {
        select: {
          host_id: true,
          title: true,
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

  if (!booking) {
    return res.status(404).json({
      success: false,
      message: 'Booking not found',
    });
  }

  // Authorization
  const isHost =
    booking.listing.host_id === req.user.id;

  const isUser =
    booking.user_id === req.user.id;

  const isAdmin =
    req.user.role === 'admin' ||
    req.user.role === 'super_admin';

  // Allowed status transitions
  const validTransitions = {
    pending: ['confirmed', 'cancelled'],
    confirmed: ['checked_in', 'cancelled'],
    checked_in: ['checked_out', 'cancelled'],
    checked_out: [],
    cancelled: [],
    no_show: [],
  };

  if (!validTransitions[booking.status]?.includes(status)) {
    return res.status(400).json({
      success: false,
      message: `Cannot transition from ${booking.status} to ${status}`,
    });
  }

  // Check permissions
  let canUpdate = false;

  if (status === 'cancelled' && isUser) {
    canUpdate = ['pending', 'confirmed'].includes(
      booking.status
    );
  } else if (isHost || isAdmin) {
    canUpdate = true;
  }

  if (!canUpdate) {
    return res.status(403).json({
      success: false,
      message: 'Not authorized to update this booking status',
    });
  }

  // Check-in validation
  if (status === 'checked_in') {
    const now = new Date();

    if (new Date(booking.check_in) > now) {
      return res.status(400).json({
        success: false,
        message: 'Cannot check in before check-in date',
      });
    }
  }

  // Prepare update
  const updateData = {
    status,
  };

  if (status === 'checked_in') {
    updateData.checked_in_at = new Date();
  }

  if (status === 'checked_out') {
    updateData.checked_out_at = new Date();
  }

  // Log cancellation
  if (status === 'cancelled' && reason) {
    await prisma.userEvent.create({
      data: {
        user_id: booking.user_id,

        event_type: 'booking_cancelled',

        metadata: {
          booking_id: booking.id,
          reason,
          cancelled_by: req.user.id,
        },
      },
    });
  }

  // Update booking
  const updatedBooking = await prisma.booking.update({
    where: { id },

    data: updateData,

    include: {
      listing: {
        include: {
          host: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
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

  // Send confirmation email
  try {
    if (status === 'confirmed') {
      await emailService.sendBookingConfirmationEmail(
        booking.user.email,
        booking.user.name,
        {
          id: booking.id,
          listingTitle: booking.listing.title,
          checkIn: booking.check_in,
          checkOut: booking.check_out,
          guests: booking.guests,
          totalPrice: booking.total_price,
        }
      );
    }
  } catch (error) {
    console.error(
      'Failed to send booking status email:',
      error
    );
  }

  // Clear cache
  await redisHelpers.del(`booking:${id}`);
  await redisHelpers.deletePattern('bookings:*');

  return res.status(200).json({
    success: true,
    message: `Booking ${status} successfully`,
    data: updatedBooking,
  });
});


// @desc    Cancel booking
// @route   POST /api/v1/bookings/:id/cancel
// @access  Private
const cancelBooking = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { reason } = req.body;

  const booking = await prisma.booking.findUnique({
    where: { id },

    include: {
      listing: {
        select: {
          host_id: true,
          title: true,
        },
      },
    },
  });

  if (!booking) {
    return res.status(404).json({
      success: false,
      message: 'Booking not found',
    });
  }

  // Authorization
  const isUser =
    booking.user_id === req.user.id;

  const isHost =
    booking.listing.host_id === req.user.id;

  const isAdmin =
    req.user.role === 'admin' ||
    req.user.role === 'super_admin';

  if (!isUser && !isHost && !isAdmin) {
    return res.status(403).json({
      success: false,
      message: 'Not authorized to cancel this booking',
    });
  }

  // Only pending and confirmed bookings can be cancelled
  const cancellableStatuses = [
    'pending',
    'confirmed',
  ];

  if (!cancellableStatuses.includes(booking.status)) {
    return res.status(400).json({
      success: false,
      message: `Booking with status ${booking.status} cannot be cancelled`,
    });
  }

  // Cancel booking
  const updatedBooking = await prisma.booking.update({
    where: { id },

    data: {
      status: 'cancelled',
    },
  });

  // Log cancellation
  await prisma.userEvent.create({
    data: {
      user_id: booking.user_id,

      event_type: 'booking_cancelled',

      metadata: {
        booking_id: booking.id,
        reason: reason || 'Booking cancelled',
        cancelled_by: req.user.id,
      },
    },
  });

  // Clear cache
  await redisHelpers.del(`booking:${id}`);
  await redisHelpers.deletePattern('bookings:*');

  return res.status(200).json({
    success: true,
    message: 'Booking cancelled successfully',
    data: updatedBooking,
  });
});


// @desc    Check booking availability
// @route   POST /api/v1/bookings/check-availability
// @access  Public
const checkAvailability = asyncHandler(async (req, res) => {
  const {
    listing_id,
    check_in,
    check_out,
  } = req.body;

  if (!listing_id || !check_in || !check_out) {
    return res.status(400).json({
      success: false,
      message:
        'Listing ID, check-in and check-out dates are required',
    });
  }

  const listing = await prisma.listing.findUnique({
    where: { id: listing_id },

    include: {
      bookings: {
        where: {
          status: {
            in: ['pending', 'confirmed', 'checked_in'],
          },
        },

        select: {
          check_in: true,
          check_out: true,
          status: true,
        },
      },
    },
  });

  if (!listing) {
    return res.status(404).json({
      success: false,
      message: 'Listing not found',
    });
  }

  const checkInDate = new Date(check_in);
  const checkOutDate = new Date(check_out);

  if (
    Number.isNaN(checkInDate.getTime()) ||
    Number.isNaN(checkOutDate.getTime())
  ) {
    return res.status(400).json({
      success: false,
      message: 'Invalid check-in or check-out date',
    });
  }

  // Check booking conflicts
  const isAvailable = listing.bookings.every(
    (booking) => {
      return !datesOverlap(
        checkInDate,
        checkOutDate,
        new Date(booking.check_in),
        new Date(booking.check_out)
      );
    }
  );

  // Check blocked dates
  const blockedDates =
    listing.blocked_dates || [];

  const isBlocked = blockedDates.some(
    (block) => {
      return datesOverlap(
        checkInDate,
        checkOutDate,
        new Date(block.start),
        new Date(block.end)
      );
    }
  );

  const available =
    isAvailable &&
    !isBlocked &&
    listing.is_active &&
    listing.status === 'active';

  // Calculate booking value
  let totalPrice = null;

  if (available) {
    totalPrice = calculateBookingPrice(
      parseFloat(listing.price),
      checkInDate,
      checkOutDate,
      req.body.guests || 1
    );
  }

  return res.status(200).json({
    success: true,

    data: {
      available,
      listing_id: listing.id,
      title: listing.title,
      price_per_night: listing.price,
      total_price: totalPrice,
      check_in: checkInDate,
      check_out: checkOutDate,
    },
  });
});


// @desc    Get booking stats for host
// @route   GET /api/v1/bookings/stats/host
// @access  Private (Host only)
const getHostStats = asyncHandler(async (req, res) => {
  const hostId = req.user.id;

  const [
    totalBookings,
    upcomingBookings,
    completedBookings,
    totalBookingValue,
  ] = await Promise.all([
    // Total bookings
    prisma.booking.count({
      where: {
        listing: {
          host_id: hostId,
        },
      },
    }),

    // Upcoming bookings
    prisma.booking.count({
      where: {
        listing: {
          host_id: hostId,
        },

        check_in: {
          gte: new Date(),
        },

        status: {
          in: ['confirmed', 'pending'],
        },
      },
    }),

    // Completed bookings
    prisma.booking.count({
      where: {
        listing: {
          host_id: hostId,
        },

        status: 'checked_out',
      },
    }),

    // Total booking value
    // This is NOT payment revenue.
    prisma.booking.aggregate({
      where: {
        listing: {
          host_id: hostId,
        },

        status: {
          in: [
            'confirmed',
            'checked_in',
            'checked_out',
          ],
        },
      },

      _sum: {
        total_price: true,
      },
    }),
  ]);

  // Booking value for the last 6 months
  const sixMonthsAgo = new Date();

  sixMonthsAgo.setMonth(
    sixMonthsAgo.getMonth() - 6
  );

  const monthlyBookingValue =
    await prisma.$queryRaw`
      SELECT
        DATE_TRUNC('month', created_at) AS month,
        SUM(total_price) AS booking_value
      FROM bookings
      WHERE listing_id IN (
        SELECT id
        FROM listings
        WHERE host_id = ${hostId}
      )
      AND status IN (
        'confirmed',
        'checked_in',
        'checked_out'
      )
      AND created_at >= ${sixMonthsAgo}
      GROUP BY DATE_TRUNC('month', created_at)
      ORDER BY month DESC
    `;

  return res.status(200).json({
    success: true,

    data: {
      total_bookings: totalBookings,
      upcoming_bookings: upcomingBookings,
      completed_bookings: completedBookings,

      // Booking value only.
      // The application does not process payments.
      total_booking_value:
        totalBookingValue._sum.total_price || 0,

      monthly_booking_value:
        monthlyBookingValue,
    },
  });
});


module.exports = {
  createBooking,
  getMyBookings,
  getHostBookings,
  getBookingById,
  updateBookingStatus,
  cancelBooking,
  checkAvailability,
  getHostStats,
};

