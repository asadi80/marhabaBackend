const { prisma } = require('../config/database');
const { calculateBookingPrice, datesOverlap } = require('../utils/helpers');
const { BOOKING_STATUS } = require('../utils/constants');

class BookingModel {
  /**
   * Create a new booking
   */
  static async create(data) {
    return prisma.booking.create({
      data: {
        listing_id: data.listing_id,
        user_id: data.user_id,
        check_in: new Date(data.check_in),
        check_out: new Date(data.check_out),
        total_price: data.total_price || 0,
        guests: data.guests || 1,
        status: data.status || 'pending',
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
        payments: true,
      },
    });
  }

  /**
   * Find booking by ID
   */
  static async findById(id, include = {}) {
    return prisma.booking.findUnique({
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
        ...include,
      },
    });
  }

  /**
   * Find bookings by user ID
   */
  static async findByUser(userId, options = {}) {
    const { page = 1, limit = 10, status, upcoming } = options;
    const skip = (page - 1) * limit;

    const where = { user_id: userId };

    if (status) {
      where.status = status;
    }

    if (upcoming === 'true') {
      where.check_in = { gte: new Date() };
      where.status = { in: ['confirmed', 'pending'] };
    }

    const [bookings, total] = await Promise.all([
      prisma.booking.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip,
        take: parseInt(limit),
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
          payments: {
            select: {
              id: true,
              amount: true,
              status: true,
              type: true,
              paid_at: true,
              sadad_reference: true,
            },
          },
        },
      }),
      prisma.booking.count({ where }),
    ]);

    return {
      data: bookings,
      total,
      page: parseInt(page),
      limit: parseInt(limit),
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Find bookings by host ID
   */
  static async findByHost(hostId, options = {}) {
    const { page = 1, limit = 10, status, listing_id } = options;
    const skip = (page - 1) * limit;

    const where = {
      listing: {
        host_id: hostId,
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
        skip,
        take: parseInt(limit),
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
          payments: {
            select: {
              id: true,
              amount: true,
              status: true,
              type: true,
              paid_at: true,
              sadad_reference: true,
            },
          },
        },
      }),
      prisma.booking.count({ where }),
    ]);

    return {
      data: bookings,
      total,
      page: parseInt(page),
      limit: parseInt(limit),
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Update booking
   */
  static async update(id, data) {
    return prisma.booking.update({
      where: { id },
      data,
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
  }

  /**
   * Update booking status
   */
  static async updateStatus(id, status, extraData = {}) {
    const updateData = {
      status,
      ...extraData,
    };

    if (status === 'checked_in') {
      updateData.checked_in_at = new Date();
    }

    if (status === 'checked_out') {
      updateData.checked_out_at = new Date();
    }

    return this.update(id, updateData);
  }

  /**
   * Check if dates are available for a listing
   */
  static async checkAvailability(listingId, checkIn, checkOut, excludeBookingId = null) {
    const listing = await prisma.listing.findUnique({
      where: { id: listingId },
      include: {
        bookings: {
          where: {
            status: {
              in: ['pending', 'confirmed', 'checked_in'],
            },
            ...(excludeBookingId && {
              NOT: {
                id: excludeBookingId,
              },
            }),
          },
        },
      },
    });

    if (!listing) {
      return { available: false, message: 'Listing not found' };
    }

    const checkInDate = new Date(checkIn);
    const checkOutDate = new Date(checkOut);

    // Check if listing is active
    if (!listing.is_active || listing.status !== 'active') {
      return { available: false, message: 'Listing is not available' };
    }

    // Check overlapping bookings
    const hasOverlap = listing.bookings.some(booking => {
      return datesOverlap(
        checkInDate,
        checkOutDate,
        new Date(booking.check_in),
        new Date(booking.check_out)
      );
    });

    if (hasOverlap) {
      return { available: false, message: 'Selected dates are not available' };
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
      return { available: false, message: 'Selected dates are blocked by host' };
    }

    // Calculate price
    const totalPrice = calculateBookingPrice(
      parseFloat(listing.price),
      checkInDate,
      checkOutDate,
      1
    );

    return {
      available: true,
      price_per_night: listing.price,
      total_price: totalPrice,
    };
  }

  /**
   * Get booking statistics for a host
   */
  static async getHostStats(hostId) {
    const [totalBookings, upcomingBookings, completedBookings, totalRevenue] = await Promise.all([
      prisma.booking.count({
        where: {
          listing: { host_id: hostId },
        },
      }),
      prisma.booking.count({
        where: {
          listing: { host_id: hostId },
          check_in: { gte: new Date() },
          status: { in: ['confirmed', 'pending'] },
        },
      }),
      prisma.booking.count({
        where: {
          listing: { host_id: hostId },
          status: 'checked_out',
        },
      }),
      prisma.booking.aggregate({
        where: {
          listing: { host_id: hostId },
          status: { in: ['confirmed', 'checked_in', 'checked_out'] },
        },
        _sum: { total_price: true },
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

    return {
      total_bookings: totalBookings,
      upcoming_bookings: upcomingBookings,
      completed_bookings: completedBookings,
      total_revenue: totalRevenue._sum.total_price || 0,
      monthly_revenue: monthlyRevenue,
    };
  }

  /**
   * Cancel booking and calculate refund
   */
  static async cancelBooking(id, reason = null, cancelledBy = null) {
    const booking = await this.findById(id);

    if (!booking) {
      throw new Error('Booking not found');
    }

    // Check if booking can be cancelled
    const cancellableStatuses = ['pending', 'confirmed'];
    if (!cancellableStatuses.includes(booking.status)) {
      throw new Error(`Booking with status ${booking.status} cannot be cancelled`);
    }

    // Calculate refund based on cancellation policy
    const now = new Date();
    const checkIn = new Date(booking.check_in);
    const daysUntilCheckIn = Math.ceil((checkIn - now) / (1000 * 60 * 60 * 24));
    const policy = booking.listing.cancellation_policy;

    let refundAmount = 0;
    let refundPercentage = 0;

    if (policy === 'flexible') {
      if (daysUntilCheckIn >= 1) {
        refundPercentage = 100;
      } else if (daysUntilCheckIn >= 0) {
        refundPercentage = 50;
      }
    } else if (policy === 'moderate') {
      if (daysUntilCheckIn >= 5) {
        refundPercentage = 100;
      } else if (daysUntilCheckIn >= 1) {
        refundPercentage = 50;
      }
    } else if (policy === 'strict') {
      if (daysUntilCheckIn >= 14) {
        refundPercentage = 100;
      } else if (daysUntilCheckIn >= 7) {
        refundPercentage = 50;
      }
    }

    refundAmount = (booking.total_price * refundPercentage) / 100;

    // Update booking status
    const updatedBooking = await this.updateStatus(id, 'cancelled');

    // Update payments if refund
    if (refundAmount > 0) {
      await prisma.bookingPayment.updateMany({
        where: {
          booking_id: id,
          status: 'completed',
        },
        data: {
          status: 'refunded',
          notes: `Refunded: ${refundAmount} (${refundPercentage}% of total)`,
        },
      });
    }

    // Log cancellation
    if (cancelledBy) {
      await prisma.userEvent.create({
        data: {
          user_id: cancelledBy,
          event_type: 'booking_cancelled',
          metadata: {
            booking_id: id,
            reason: reason || 'User cancelled',
            cancelled_by: cancelledBy,
            refund_amount: refundAmount,
            refund_percentage: refundPercentage,
          },
        },
      });
    }

    return {
      booking: updatedBooking,
      refund_amount: refundAmount,
      refund_percentage: refundPercentage,
    };
  }
}

module.exports = BookingModel;