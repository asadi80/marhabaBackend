const { prisma } = require("../config/database");
const { redisHelpers } = require("../config/redis");
const { asyncHandler } = require("../middleware/errorHandler");
const { paginate, paginationMeta } = require("../utils/helpers");

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

    amenities: Array.isArray(amenities) ? amenities : [],

    rules: Array.isArray(rules) ? rules : [],

    cancellation_policy: cancellation_policy || {
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
  const currentHostDetails = listing.host?.host_details || {};

  await prisma.user.update({
    where: {
      id: req.user.id,
    },
    data: {
      host_details: {
        ...currentHostDetails,
        totalListings: (Number(currentHostDetails.totalListings) || 0) + 1,
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
    status: "active",
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
      mode: "insensitive",
    };
  }

  if (search) {
    where.OR = [
      { title: { contains: search, mode: "insensitive" } },
      { description: { contains: search, mode: "insensitive" } },
      { location: { contains: search, mode: "insensitive" } },
    ];
  }

  // Build sort
  let orderBy = { created_at: "desc" };
  if (sort === "price_asc") orderBy = { price: "asc" };
  if (sort === "price_desc") orderBy = { price: "desc" };
  if (sort === "rating")
    orderBy = { host: { host_details: { rating: "desc" } } };

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
            status: { in: ["confirmed", "checked_in"] },
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
          status: { in: ["confirmed", "checked_in"] },
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
      message: "Listing not found",
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
    is_active,
  } = req.body;

  // =========================================================
  // CHECK LISTING OWNERSHIP
  // =========================================================

  const existingListing = await prisma.listing.findFirst({
    where: {
      id,
      host_id: req.user.id,
    },
  });

  if (!existingListing) {
    return res.status(404).json({
      success: false,
      message: "Listing not found or you are not the owner",
    });
  }

  // =========================================================
  // COORDINATES
  // =========================================================

  /*
   * Support both:
   *
   * latitude / longitude
   *
   * and:
   *
   * coordinates: {
   *   lat,
   *   lng
   * }
   */

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

  // =========================================================
  // BUILD UPDATE DATA
  // =========================================================

  const data = {};

  // ---------------------------------------------------------
  // Basic fields
  // ---------------------------------------------------------

  if (title !== undefined) {
    data.title = title;
  }

  if (description !== undefined) {
    data.description = description;
  }

  if (location !== undefined) {
    data.location = location;
  }

  // ---------------------------------------------------------
  // Price
  // ---------------------------------------------------------

  if (price !== undefined && price !== null && price !== "") {
    const parsedPrice = parseFloat(price);

    if (Number.isNaN(parsedPrice)) {
      return res.status(400).json({
        success: false,
        message: "Price must be a valid number",
      });
    }

    data.price = parsedPrice;
  }

  // ---------------------------------------------------------
  // Latitude
  // ---------------------------------------------------------

  if (
    finalLatitude !== undefined &&
    finalLatitude !== null &&
    finalLatitude !== ""
  ) {
    const parsedLatitude = parseFloat(finalLatitude);

    if (Number.isNaN(parsedLatitude)) {
      return res.status(400).json({
        success: false,
        message: "Latitude must be a valid number",
      });
    }

    if (parsedLatitude < -90 || parsedLatitude > 90) {
      return res.status(400).json({
        success: false,
        message: "Latitude must be between -90 and 90",
      });
    }

    data.latitude = parsedLatitude;
  } else if (finalLatitude === null || finalLatitude === "") {
    data.latitude = null;
  }

  // ---------------------------------------------------------
  // Longitude
  // ---------------------------------------------------------

  if (
    finalLongitude !== undefined &&
    finalLongitude !== null &&
    finalLongitude !== ""
  ) {
    const parsedLongitude = parseFloat(finalLongitude);

    if (Number.isNaN(parsedLongitude)) {
      return res.status(400).json({
        success: false,
        message: "Longitude must be a valid number",
      });
    }

    if (parsedLongitude < -180 || parsedLongitude > 180) {
      return res.status(400).json({
        success: false,
        message: "Longitude must be between -180 and 180",
      });
    }

    data.longitude = parsedLongitude;
  } else if (finalLongitude === null || finalLongitude === "") {
    data.longitude = null;
  }

  // ---------------------------------------------------------
  // Images
  // ---------------------------------------------------------

  if (images !== undefined) {
    data.images = Array.isArray(images) ? images : [];
  }

  // ---------------------------------------------------------
  // Category
  // ---------------------------------------------------------

  if (category !== undefined) {
    data.category = category || "city";
  }

  // ---------------------------------------------------------
  // Amenities
  // ---------------------------------------------------------

  if (amenities !== undefined) {
    data.amenities = Array.isArray(amenities) ? amenities : [];
  }

  // ---------------------------------------------------------
  // Rules
  // ---------------------------------------------------------

  if (rules !== undefined) {
    data.rules = Array.isArray(rules) ? rules : [];
  }

  // ---------------------------------------------------------
  // Cancellation policy
  // ---------------------------------------------------------

  if (cancellation_policy !== undefined) {
    data.cancellation_policy = cancellation_policy || {
      type: "flexible",
      description: "",
      rules: [],
    };
  }

  // ---------------------------------------------------------
  // Active status
  // ---------------------------------------------------------

  if (is_active !== undefined) {
    data.is_active = Boolean(is_active);
  }

  // =========================================================
  // LOG
  // =========================================================

  console.log("📦 Updating listing:", id);

  console.log("📦 Update data:", data);

  // =========================================================
  // UPDATE LISTING
  // =========================================================

  const updatedListing = await prisma.listing.update({
    where: {
      id,
    },

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

  // =========================================================
  // CLEAR CACHE
  // =========================================================

  await redisHelpers.del(`listing:${id}`);

  await redisHelpers.deletePattern("listings:*");

  // =========================================================
  // RESPONSE
  // =========================================================

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
          status: { in: ["pending", "confirmed"] },
        },
      },
    },
  });

  if (!listing) {
    return res.status(404).json({
      success: false,
      message: "Listing not found or you are not the owner",
    });
  }

  // Check if listing has active bookings
  if (listing.bookings.length > 0) {
    return res.status(400).json({
      success: false,
      message: "Cannot delete listing with active bookings",
    });
  }

  // Soft delete - deactivate instead of delete
  await prisma.listing.update({
    where: { id },
    data: {
      is_active: false,
      status: "inactive",
    },
  });

  // Clear cache
  await redisHelpers.del(`listing:${id}`);
  await redisHelpers.deletePattern("listings:*");

  res.status(200).json({
    success: true,
    message: "Listing deactivated successfully",
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
    ...(req.user?.id !== hostId && { status: "active", is_active: true }),
  };

  const [listings, total] = await Promise.all([
    prisma.listing.findMany({
      where,
      orderBy: { created_at: "desc" },
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
            status: { in: ["confirmed", "checked_in"] },
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

// @desc    Toggle listing active status
// @route   PATCH /api/v1/listings/:id/toggle-active
// @access  Private (Host only)
const toggleListingActive = asyncHandler(async (req, res) => {
  const { id } = req.params;

  // Check if listing exists and belongs to logged-in host
  const listing = await prisma.listing.findFirst({
    where: {
      id,
      host_id: req.user.id,
    },
    select: {
      id: true,
      is_active: true,
      status: true,
    },
  });

  if (!listing) {
    return res.status(404).json({
      success: false,
      message: "Listing not found or you are not the owner",
      code: "LISTING_NOT_FOUND",
    });
  }

  // Toggle active status
  const newIsActive = !listing.is_active;

  // Keep status consistent with is_active
  const newStatus = newIsActive ? "active" : "inactive";

  const updatedListing = await prisma.listing.update({
    where: {
      id,
    },
    data: {
      is_active: newIsActive,
      status: newStatus,
      updated_at: new Date(),
    },
    select: {
      id: true,
      is_active: true,
      status: true,
      updated_at: true,
    },
  });

  // Clear listing caches
  await redisHelpers.del(`listing:${id}`);
  await redisHelpers.deletePattern("listings:*");

  // Return response
  return res.status(200).json({
    success: true,
    message: newIsActive
      ? "Listing activated successfully"
      : "Listing deactivated successfully",
    data: updatedListing,
  });
});


const getListingForUser = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const cacheKey = `listing:${id}`;

  // Check cache
  const cachedListing = await redisHelpers.get(cacheKey);

  if (cachedListing) {
    return res.status(200).json({
      success: true,
      data: cachedListing,
    });
  }

  const listing = await prisma.listing.findUnique({
    where: {
      id,
    },

    include: {
      // PUBLIC HOST INFORMATION ONLY
      host: {
        select: {
          id: true,
          name: true,
          email: true,
          phone_number: true,
          host_details: true,
          created_at: true,

          // ❌ DO NOT INCLUDE:
          // id_images
          // id_documents
          // payment receipts
          // verification documents
        },
      },

      // Only booking dates are needed to show availability
      bookings: {
        where: {
          status: {
            in: ["confirmed", "checked_in"],
          },
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
      message: "Listing not found",
    });
  }

  // Convert Prisma Decimal values to normal numbers
  const responseListing = {
    ...listing,

    latitude:
      listing.latitude !== null
        ? Number(listing.latitude)
        : null,

    longitude:
      listing.longitude !== null
        ? Number(listing.longitude)
        : null,

    // Frontend-friendly coordinates
    coordinates:
      listing.latitude !== null &&
      listing.longitude !== null
        ? {
            lat: Number(listing.latitude),
            lng: Number(listing.longitude),
          }
        : null,
  };

  // Cache for 5 minutes
  await redisHelpers.set(
    cacheKey,
    responseListing,
    300
  );

  return res.status(200).json({
    success: true,
    data: responseListing,
  });
});

module.exports = {
  createListing,
  getListings,
  getListing,
  updateListing,
  deleteListing,
  getHostListings,
  toggleListingActive,
  getListingForUser
};
