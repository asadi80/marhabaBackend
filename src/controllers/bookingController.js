//src/controller/bookingController.js
const { prisma } = require('../config/database');
const { redisHelpers } = require('../config/redis');
const { asyncHandler } = require('../middleware/errorHandler');
const { 
  paginate, 
  paginationMeta, 
  calculateBookingPrice, 
  datesOverlap,
  formatDate 
} = require('../utils/helpers');
const emailService = require('../services/emailService');
const { BOOKING_STATUS, PAYMENT_STATUS } = require('../utils/constants');

// @desc    Create booking
// @route   POST /api/v1/bookings
// @access  Private
const createBooking = asyncHandler(async (req, res) => {
  const { listing_id, check_in, check_out, guests = 1 } = req.body;

  // Check if listing exists and is available
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
          status: { in: ['pending', 'confirmed', 'checked_in'] },
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

  if (!listing.is_active || listing.status !== 'active') {
    return res.status(400).json({
      success: false,
      message: 'Listing is not available',
    });
  }

  // Check if user is trying to book their own listing
  if (listing.host_id === req.user.id) {
    return res.status(400).json({
      success: false,
      message: 'You cannot book your own listing',
    });
  }

  // Check date availability
  const checkInDate = new Date(check_in);
  const checkOutDate = new Date(check_out);
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

  // Check if dates are available
  const isAvailable = listing.bookings.every(booking => {
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
  const isBlocked = blockedDates.some(block => {
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

  // Calculate total price
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

  // Create pending payment record
  await prisma.bookingPayment.create({
    data: {
      booking_id: booking.id,
      type: 'sadad',
      amount: totalPrice,
      status: 'pending',
    },
  });

  // Send email notification to user
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
    console.error('Failed to send booking confirmation email:', error);
  }

  // Clear cache
  await redisHelpers.deletePattern(`bookings:*`);

  res.status(201).json({
    success: true,
    message: 'Booking created successfully',
    data: booking,
  });
});

// @desc    Get all bookings for current user
// @route   GET /api/v1/bookings/my-booking
// @access  Private
// src/controllers/bookingController.js

const getMyBookings = asyncHandler(async (req, res) => {
  const { page, limit } = paginate(req.query.page, req.query.limit);
  const { status, upcoming } = req.query;

  // Ensure user exists
  if (!req.user || !req.user.id) {
    return res.status(401).json({
      success: false,
      message: 'User not authenticated'
    });
  }

  const where = {
    user_id: req.user.id,
  };

  // Add status filter if provided
  if (status) {
    const validStatuses = ['pending', 'confirmed', 'checked_in', 'checked_out', 'cancelled', 'no_show'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status parameter'
      });
    }
    where.status = status;
  }

  // Handle upcoming filter
  if (upcoming === 'true') {
    where.check_in = {
      gte: new Date(),
    };
    where.status = {
      in: ['confirmed', 'pending'],
    };
  }

  try {
    const cacheKey = `bookings:user:${req.user.id}:${JSON.stringify({ where, skip: paginate.skip, take: paginate.take })}`;
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
        orderBy: { created_at: 'desc' },
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
          // REMOVED: payments (doesn't exist in schema)
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
      prisma.booking.count({ where }),
    ]);

    const meta = paginationMeta(total, paginate.page, paginate.limit);
    const result = { data: bookings, meta };

    // Cache for 5 minutes
    await redisHelpers.set(cacheKey, result, 300);

    return res.status(200).json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error('Error fetching bookings:', error);
    // Return empty bookings array on error
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
  const { page, limit } = paginate(req.query.page, req.query.limit);
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
      orderBy: { created_at: 'desc' },
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
        // REMOVED: payments (doesn't exist in schema)
      },
    }),
    prisma.booking.count({ where }),
  ]);

  const meta = paginationMeta(total, paginate.page, paginate.limit);

  res.status(200).json({
    success: true,
    data: bookings,
    meta,
  });
});

// @desc    Get single booking
// @route   GET /api/v1/bookings/:id
// @access  Private
const getBooking = asyncHandler(async (req, res) => {
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
      payments: {
        select: {
          id: true,
          amount: true,
          status: true,
          type: true,
          paid_at: true,
          sadad_reference: true,
          sadad_transaction_id: true,
          notes: true,
          created_at: true,
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

  // Check if user is authorized (booking owner, listing host, or admin)
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

  res.status(200).json({
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

  // Check authorization
  const isHost = booking.listing.host_id === req.user.id;
  const isUser = booking.user_id === req.user.id;
  const isAdmin = req.user.role === 'admin' || req.user.role === 'super_admin';

  // Status update permissions
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

  // Check who can update
  let canUpdate = false;
  if (status === 'cancelled' && isUser) {
    // User can cancel only if booking is pending or confirmed
    canUpdate = ['pending', 'confirmed'].includes(booking.status);
  } else if (isHost || isAdmin) {
    canUpdate = true;
  }

  if (!canUpdate) {
    return res.status(403).json({
      success: false,
      message: 'Not authorized to update this booking status',
    });
  }

  // Special handling for check-in/check-out
  if (status === 'checked_in') {
    const now = new Date();
    if (new Date(booking.check_in) > now) {
      return res.status(400).json({
        success: false,
        message: 'Cannot check in before check-in date',
      });
    }
  }

  // Update booking
  const updateData = {
    status,
  };

  if (status === 'checked_in') {
    updateData.checked_in_at = new Date();
  }

  if (status === 'checked_out') {
    updateData.checked_out_at = new Date();
  }

  if (status === 'cancelled' && reason) {
    // Log cancellation reason if needed
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
      payments: true,
    },
  });

  // Send notification email
  try {
    const emailData = {
      bookingId: booking.id,
      listingTitle: booking.listing.title,
      status,
      checkIn: booking.check_in,
      checkOut: booking.check_out,
    };

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
    console.error('Failed to send booking status email:', error);
  }

  // Clear cache
  await redisHelpers.del(`booking:${id}`);
  await redisHelpers.deletePattern('bookings:*');

  res.status(200).json({
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
          cancellation_policy: true,
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

  // Check if user can cancel
  const isUser = booking.user_id === req.user.id;
  const isHost = booking.listing.host_id === req.user.id;
  const isAdmin = req.user.role === 'admin' || req.user.role === 'super_admin';

  if (!isUser && !isHost && !isAdmin) {
    return res.status(403).json({
      success: false,
      message: 'Not authorized to cancel this booking',
    });
  }

  // Check if booking can be cancelled
  const cancellableStatuses = ['pending', 'confirmed'];
  if (!cancellableStatuses.includes(booking.status)) {
    return res.status(400).json({
      success: false,
      message: `Booking with status ${booking.status} cannot be cancelled`,
    });
  }

  // Check cancellation policy for refund eligibility
  const now = new Date();
  const checkIn = new Date(booking.check_in);
  const daysUntilCheckIn = Math.ceil((checkIn - now) / (1000 * 60 * 60 * 24));

  let refundAmount = 0;
  let cancellationMessage = 'Booking cancelled';

  if (booking.listing.cancellation_policy === 'flexible') {
    if (daysUntilCheckIn >= 1) {
      refundAmount = booking.total_price;
      cancellationMessage = 'Booking cancelled - Full refund';
    } else if (daysUntilCheckIn < 1 && daysUntilCheckIn >= 0) {
      refundAmount = booking.total_price * 0.5;
      cancellationMessage = 'Booking cancelled - 50% refund';
    }
  } else if (booking.listing.cancellation_policy === 'moderate') {
    if (daysUntilCheckIn >= 5) {
      refundAmount = booking.total_price;
      cancellationMessage = 'Booking cancelled - Full refund';
    } else if (daysUntilCheckIn >= 1 && daysUntilCheckIn < 5) {
      refundAmount = booking.total_price * 0.5;
      cancellationMessage = 'Booking cancelled - 50% refund';
    }
  } else if (booking.listing.cancellation_policy === 'strict') {
    if (daysUntilCheckIn >= 14) {
      refundAmount = booking.total_price;
      cancellationMessage = 'Booking cancelled - Full refund';
    } else if (daysUntilCheckIn >= 7 && daysUntilCheckIn < 14) {
      refundAmount = booking.total_price * 0.5;
      cancellationMessage = 'Booking cancelled - 50% refund';
    }
  }

  // Update booking
  const updatedBooking = await prisma.booking.update({
    where: { id },
    data: {
      status: 'cancelled',
    },
    include: {
      payments: true,
    },
  });

  // Update payment status if refund
  if (refundAmount > 0) {
    await prisma.bookingPayment.updateMany({
      where: {
        booking_id: id,
        status: 'completed',
      },
      data: {
        status: 'refunded',
        notes: `Refunded: ${refundAmount} (${cancellationMessage})`,
      },
    });
  }

  // Log cancellation event
  await prisma.userEvent.create({
    data: {
      user_id: req.user.id,
      event_type: 'booking_cancelled',
      metadata: {
        booking_id: booking.id,
        reason: reason || 'User cancelled',
        cancelled_by: req.user.id,
        refund_amount: refundAmount,
      },
    },
  });

  // Clear cache
  await redisHelpers.del(`booking:${id}`);
  await redisHelpers.deletePattern('bookings:*');

  res.status(200).json({
    success: true,
    message: cancellationMessage,
    data: {
      booking: updatedBooking,
      refund_amount: refundAmount,
    },
  });
});

// @desc    Check booking availability
// @route   POST /api/v1/bookings/check-availability
// @access  Public
const checkAvailability = asyncHandler(async (req, res) => {
  const { listing_id, check_in, check_out } = req.body;

  if (!listing_id || !check_in || !check_out) {
    return res.status(400).json({
      success: false,
      message: 'Listing ID, check-in and check-out dates are required',
    });
  }

  const listing = await prisma.listing.findUnique({
    where: { id: listing_id },
    include: {
      bookings: {
        where: {
          status: { in: ['pending', 'confirmed', 'checked_in'] },
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

  // Check if dates are available
  const isAvailable = listing.bookings.every(booking => {
    return !datesOverlap(
      checkInDate,
      checkOutDate,
      new Date(booking.check_in),
      new Date(booking.check_out)
    );
  });

  // Check blocked dates
  const blockedDates = listing.blocked_dates || [];
  const isBlocked = blockedDates.some(block => {
    return datesOverlap(
      checkInDate,
      checkOutDate,
      new Date(block.start),
      new Date(block.end)
    );
  });

  const available = isAvailable && !isBlocked && listing.is_active;

  // Calculate price if available
  let totalPrice = null;
  if (available) {
    totalPrice = calculateBookingPrice(
      parseFloat(listing.price),
      checkInDate,
      checkOutDate,
      req.body.guests || 1
    );
  }

  res.status(200).json({
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

  const [totalBookings, upcomingBookings, completedBookings, totalRevenue] = await Promise.all([
    prisma.booking.count({
      where: {
        listing: {
          host_id: hostId,
        },
      },
    }),
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
    prisma.booking.count({
      where: {
        listing: {
          host_id: hostId,
        },
        status: 'checked_out',
      },
    }),
    prisma.booking.aggregate({
      where: {
        listing: {
          host_id: hostId,
        },
        status: {
          in: ['confirmed', 'checked_in', 'checked_out'],
        },
      },
      _sum: {
        total_price: true,
      },
    }),
  ]);

  // Get monthly revenue for last 6 months
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

  const monthlyRevenue = await prisma.$queryRaw`
    SELECT 
      DATE_TRUNC('month', created_at) as month,
      SUM(total_price) as revenue
    FROM bookings
    WHERE listing_id IN (
      SELECT id FROM listings WHERE host_id = ${hostId}
    )
    AND status IN ('confirmed', 'checked_in', 'checked_out')
    AND created_at >= ${sixMonthsAgo}
    GROUP BY DATE_TRUNC('month', created_at)
    ORDER BY month DESC
  `;

  res.status(200).json({
    success: true,
    data: {
      total_bookings: totalBookings,
      upcoming_bookings: upcomingBookings,
      completed_bookings: completedBookings,
      total_revenue: totalRevenue._sum.total_price || 0,
      monthly_revenue: monthlyRevenue,
    },
  });
});

module.exports = {
  createBooking,
  getMyBookings,
  getHostBookings,
  getBooking,
  updateBookingStatus,
  cancelBooking,
  checkAvailability,
  getHostStats,
};