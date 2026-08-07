const { prisma } = require('../config/database');
const { paginate } = require('../utils/helpers');

class ListingModel {
  /**
   * Create a new listing
   */
  static async create(data) {
    return prisma.listing.create({
      data: {
        title: data.title,
        description: data.description,
        price: parseFloat(data.price),
        location: data.location,
        latitude: data.latitude ? parseFloat(data.latitude) : null,
        longitude: data.longitude ? parseFloat(data.longitude) : null,
        images: data.images || [],
        category: data.category || 'city',
        amenities: data.amenities || [],
        host_id: data.host_id,
        rules: data.rules || [],
        cancellation_policy: data.cancellation_policy || 'flexible',
        status: data.status || 'active',
        is_active: data.is_active !== undefined ? data.is_active : true,
        blocked_dates: data.blocked_dates || [],
        view_count: 0,
      },
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
    });
  }

  /**
   * Find listing by ID
   */
  static async findById(id, include = {}) {
    return prisma.listing.findUnique({
      where: { id },
      include: {
        host: {
          select: {
            id: true,
            name: true,
            email: true,
            phone_number: true,
            host_details: true,
            id_images: true,
            created_at: true,
          },
        },
        bookings: {
          where: {
            status: { in: ['confirmed', 'checked_in'] },
          },
          select: {
            check_in: true,
            check_out: true,
            status: true,
          },
        },
        ...include,
      },
    });
  }

  /**
   * Get all listings with filters
   */
  static async findAll(options = {}) {
    const {
      page = 1,
      limit = 10,
      search,
      category,
      minPrice,
      maxPrice,
      location,
      sort = 'created_at_desc',
      hostId,
      status = 'active',
      isActive = true,
      includeHost = false,
    } = options;

    const { skip, take } = paginate(page, limit);

    // Build where clause
    const where = {};

    if (status) {
      where.status = status;
    }

    if (isActive !== undefined) {
      where.is_active = isActive;
    }

    if (hostId) {
      where.host_id = hostId;
    }

    if (category) {
      where.category = category;
    }

    if (minPrice || maxPrice) {
      where.price = {};
      if (minPrice) where.price.gte = parseFloat(minPrice);
      if (maxPrice) where.price.lte = parseFloat(maxPrice);
    }

    if (location) {
      where.location = {
        contains: location,
        mode: 'insensitive',
      };
    }

    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        { location: { contains: search, mode: 'insensitive' } },
      ];
    }

    // Build order by
    const orderBy = {};
    const [field, direction] = sort.split('_');
    if (field === 'price') {
      orderBy.price = direction === 'asc' ? 'asc' : 'desc';
    } else if (field === 'rating') {
      orderBy.host = { host_details: { rating: direction === 'asc' ? 'asc' : 'desc' } };
    } else {
      orderBy.created_at = direction === 'asc' ? 'asc' : 'desc';
    }

    // Build include
    const include = {
      bookings: {
        where: {
          status: { in: ['confirmed', 'checked_in'] },
        },
        select: {
          check_in: true,
          check_out: true,
          status: true,
        },
      },
    };

    if (includeHost) {
      include.host = {
        select: {
          id: true,
          name: true,
          email: true,
          phone_number: true,
          host_details: true,
        },
      };
    }

    const [listings, total] = await Promise.all([
      prisma.listing.findMany({
        where,
        orderBy,
        skip,
        take,
        include,
      }),
      prisma.listing.count({ where }),
    ]);

    return {
      data: listings,
      total,
      page: parseInt(page),
      limit: parseInt(limit),
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Update listing
   */
  static async update(id, data) {
    const updateData = { ...data };

    // Parse numeric values
    if (updateData.price) updateData.price = parseFloat(updateData.price);
    if (updateData.latitude) updateData.latitude = parseFloat(updateData.latitude);
    if (updateData.longitude) updateData.longitude = parseFloat(updateData.longitude);

    return prisma.listing.update({
      where: { id },
      data: updateData,
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
    });
  }

  /**
   * Delete listing (soft delete)
   */
  static async delete(id) {
    return prisma.listing.update({
      where: { id },
      data: {
        is_active: false,
        status: 'inactive',
      },
    });
  }

  /**
   * Get listings by host
   */
  static async findByHost(hostId, options = {}) {
    return this.findAll({
      ...options,
      hostId,
      includeHost: true,
    });
  }

  /**
   * Increment view count
   */
  static async incrementViewCount(id) {
    return prisma.listing.update({
      where: { id },
      data: {
        view_count: {
          increment: 1,
        },
      },
    });
  }

  /**
   * Check if dates are available for listing
   */
  static async checkDateAvailability(listingId, checkIn, checkOut, excludeBookingId = null) {
    const listing = await this.findById(listingId);

    if (!listing) {
      return { available: false, message: 'Listing not found' };
    }

    const checkInDate = new Date(checkIn);
    const checkOutDate = new Date(checkOut);

    // Check listing status
    if (!listing.is_active || listing.status !== 'active') {
      return { available: false, message: 'Listing is not available' };
    }

    // Check overlapping bookings
    const hasOverlap = listing.bookings.some(booking => {
      if (excludeBookingId && booking.id === excludeBookingId) return false;
      return (
        new Date(booking.check_in) < checkOutDate &&
        new Date(booking.check_out) > checkInDate
      );
    });

    if (hasOverlap) {
      return { available: false, message: 'Dates overlap with existing booking' };
    }

    // Check blocked dates
    const blockedDates = listing.blocked_dates || [];
    const isBlocked = blockedDates.some(block => {
      return (
        new Date(block.start) < checkOutDate &&
        new Date(block.end) > checkInDate
      );
    });

    if (isBlocked) {
      return { available: false, message: 'Dates are blocked' };
    }

    return { available: true };
  }

  /**
   * Add blocked dates
   */
  static async addBlockedDates(id, dates) {
    const listing = await this.findById(id);

    if (!listing) {
      throw new Error('Listing not found');
    }

    const currentBlocked = listing.blocked_dates || [];
    const newBlocked = [...currentBlocked, ...dates];

    return prisma.listing.update({
      where: { id },
      data: {
        blocked_dates: newBlocked,
      },
    });
  }

  /**
   * Remove blocked dates
   */
  static async removeBlockedDates(id, datesToRemove) {
    const listing = await this.findById(id);

    if (!listing) {
      throw new Error('Listing not found');
    }

    const currentBlocked = listing.blocked_dates || [];
    const newBlocked = currentBlocked.filter(
      block => !datesToRemove.some(
        d => d.start === block.start && d.end === block.end
      )
    );

    return prisma.listing.update({
      where: { id },
      data: {
        blocked_dates: newBlocked,
      },
    });
  }

  /**
   * Get listing stats
   */
  static async getStats(hostId) {
    const [totalListings, activeListings, totalViews] = await Promise.all([
      prisma.listing.count({
        where: { host_id: hostId },
      }),
      prisma.listing.count({
        where: {
          host_id: hostId,
          is_active: true,
          status: 'active',
        },
      }),
      prisma.listing.aggregate({
        where: { host_id: hostId },
        _sum: { view_count: true },
      }),
    ]);

    // Get listings by category
    const byCategory = await prisma.listing.groupBy({
      by: ['category'],
      where: { host_id: hostId },
      _count: { id: true },
    });

    return {
      total_listings: totalListings,
      active_listings: activeListings,
      total_views: totalViews._sum.view_count || 0,
      by_category: byCategory.map(item => ({
        category: item.category,
        count: item._count.id,
      })),
    };
  }
}

module.exports = ListingModel;