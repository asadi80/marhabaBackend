const { prisma } = require('../config/database');
const { redisHelpers } = require('../config/redis');
const { asyncHandler } = require('../middleware/errorHandler');
const { paginate, paginationMeta } = require('../utils/helpers');

// @desc    Create listing
// @route   POST /api/v1/listings
// @access  Private (Host only)
const createListing = asyncHandler(async (req, res) => {
  const {
    title,
    description,
    price,
    location,
    latitude,
    longitude,
    coordinates,
    images,
    category,
    amenities,
    rules,
    cancellation_policy,
  } = req.body;

  // Support coordinates from frontend
  let finalLatitude = latitude;
  let finalLongitude = longitude;

  if (coordinates) {
    if (coordinates.lat !== undefined) {
      finalLatitude = coordinates.lat;
    }

    if (coordinates.lng !== undefined) {
      finalLongitude = coordinates.lng;
    }
  }

  const data = {
    title,
    description,
    price: parseFloat(price),
    location,

    latitude:
      finalLatitude !== undefined &&
      finalLatitude !== null &&
      finalLatitude !== ""
        ? parseFloat(finalLatitude)
        : null,

    longitude:
      finalLongitude !== undefined &&
      finalLongitude !== null &&
      finalLongitude !== ""
        ? parseFloat(finalLongitude)
        : null,

    images: Array.isArray(images) ? images : [],

    category: category || "city",

    amenities: Array.isArray(amenities)
      ? amenities
      : [],

    rules: Array.isArray(rules)
      ? rules
      : [],

    cancellation_policy:
      cancellation_policy || {
        type: "flexible",
        description: "",
        rules: [],
      },

    host_id: req.user.id,
  };

  console.log("📦 Creating listing with data:", data);

  const listing = await prisma.listing.create({
    data,
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

  // Update host listing count
  const currentHostDetails =
    listing.host?.host_details || {};

  await prisma.user.update({
    where: {
      id: req.user.id,
    },
    data: {
      host_details: {
        ...currentHostDetails,
        totalListings:
          (Number(currentHostDetails.totalListings) || 0) + 1,
      },
    },
  });

  await redisHelpers.deletePattern("listings:*");

  res.status(201).json({
    success: true,
    data: listing,
  });
});

// @desc    Get all listings
// @route   GET /api/v1/listings
// @access  Public
const getListings = asyncHandler(async (req, res) => {
  const { page, limit } = paginate(req.query.page, req.query.limit);
  const { search, category, minPrice, maxPrice, location, sort } = req.query;

  // Build filter
  const where = {
    status: 'active',
    is_active: true,
  };

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

  // Build sort
  let orderBy = { created_at: 'desc' };
  if (sort === 'price_asc') orderBy = { price: 'asc' };
  if (sort === 'price_desc') orderBy = { price: 'desc' };
  if (sort === 'rating') orderBy = { host: { host_details: { rating: 'desc' } } };

  // Try cache
  const cacheKey = `listings:${JSON.stringify({ where, orderBy, skip: paginate.skip, take: paginate.take })}`;
  const cachedListings = await redisHelpers.get(cacheKey);

  if (cachedListings) {
    return res.status(200).json({
      success: true,
      ...cachedListings,
    });
  }

  // Get listings
  const [listings, total] = await Promise.all([
    prisma.listing.findMany({
      where,
      orderBy,
      skip: paginate.skip,
      take: paginate.take,
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
        bookings: {
          where: {
            status: { in: ['confirmed', 'checked_in'] },
          },
          select: {
            check_in: true,
            check_out: true,
          },
        },
      },
    }),
    prisma.listing.count({ where }),
  ]);

  const meta = paginationMeta(total, paginate.page, paginate.limit);

  const result = {
    data: listings,
    meta,
  };

  // Cache for 5 minutes
  await redisHelpers.set(cacheKey, result, 300);

  res.status(200).json({
    success: true,
    ...result,
  });
});

// @desc    Get single listing
// @route   GET /api/v1/listings/:id
// @access  Public
const getListing = asyncHandler(async (req, res) => {
  const { id } = req.params;

  // Try cache
  const cacheKey = `listing:${id}`;
  const cachedListing = await redisHelpers.get(cacheKey);

  if (cachedListing) {
    // Increment view count asynchronously
    await prisma.listing.update({
      where: { id },
      data: { view_count: { increment: 1 } },
    });

    return res.status(200).json({
      success: true,
      data: cachedListing,
    });
  }

  const listing = await prisma.listing.findUnique({
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

  // Increment view count
  await prisma.listing.update({
    where: { id },
    data: { view_count: { increment: 1 } },
  });

  // Cache for 5 minutes
  await redisHelpers.set(cacheKey, listing, 300);

  res.status(200).json({
    success: true,
    data: listing,
  });
});

// @desc    Update listing
// @route   PUT /api/v1/listings/:id
// @access  Private (Host only)
const updateListing = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const data = req.body;

  // Check if listing exists and belongs to user
  const listing = await prisma.listing.findFirst({
    where: {
      id,
      host_id: req.user.id,
    },
  });

  if (!listing) {
    return res.status(404).json({
      success: false,
      message: 'Listing not found or you are not the owner',
    });
  }

  // Parse numeric values
  if (data.price) data.price = parseFloat(data.price);
  if (data.latitude) data.latitude = parseFloat(data.latitude);
  if (data.longitude) data.longitude = parseFloat(data.longitude);

  const updatedListing = await prisma.listing.update({
    where: { id },
    data,
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

  // Clear cache
  await redisHelpers.del(`listing:${id}`);
  await redisHelpers.deletePattern('listings:*');

  res.status(200).json({
    success: true,
    data: updatedListing,
  });
});

// @desc    Delete listing
// @route   DELETE /api/v1/listings/:id
// @access  Private (Host only)
const deleteListing = asyncHandler(async (req, res) => {
  const { id } = req.params;

  // Check if listing exists and belongs to user
  const listing = await prisma.listing.findFirst({
    where: {
      id,
      host_id: req.user.id,
    },
    include: {
      bookings: {
        where: {
          status: { in: ['pending', 'confirmed'] },
        },
      },
    },
  });

  if (!listing) {
    return res.status(404).json({
      success: false,
      message: 'Listing not found or you are not the owner',
    });
  }

  // Check if listing has active bookings
  if (listing.bookings.length > 0) {
    return res.status(400).json({
      success: false,
      message: 'Cannot delete listing with active bookings',
    });
  }

  // Soft delete - deactivate instead of delete
  await prisma.listing.update({
    where: { id },
    data: {
      is_active: false,
      status: 'inactive',
    },
  });

  // Clear cache
  await redisHelpers.del(`listing:${id}`);
  await redisHelpers.deletePattern('listings:*');

  res.status(200).json({
    success: true,
    message: 'Listing deactivated successfully',
  });
});

// @desc    Get host listings
// @route   GET /api/v1/listings/host/:hostId
// @access  Public
const getHostListings = asyncHandler(async (req, res) => {
  const { hostId } = req.params;
  const { page, limit } = paginate(req.query.page, req.query.limit);

  const where = {
    host_id: hostId,
    ...(req.user?.id !== hostId && { status: 'active', is_active: true }),
  };

  const [listings, total] = await Promise.all([
    prisma.listing.findMany({
      where,
      orderBy: { created_at: 'desc' },
      skip: paginate.skip,
      take: paginate.take,
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
        bookings: {
          where: {
            status: { in: ['confirmed', 'checked_in'] },
          },
          select: {
            check_in: true,
            check_out: true,
          },
        },
      },
    }),
    prisma.listing.count({ where }),
  ]);

  const meta = paginationMeta(total, paginate.page, paginate.limit);

  res.status(200).json({
    success: true,
    data: listings,
    meta,
  });
});

module.exports = {
  createListing,
  getListings,
  getListing,
  updateListing,
  deleteListing,
  getHostListings,
};