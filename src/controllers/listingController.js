const crypto = require("crypto");

const { prisma } = require("../config/database");
const { redisHelpers } = require("../config/redis");
const { asyncHandler } = require("../middleware/errorHandler");
const { paginate, paginationMeta } = require("../utils/helpers");


// ============================================================
// HAVERSINE DISTANCE
// Calculate distance between two coordinates in kilometers
// ============================================================

function deg2rad(deg) {
  return deg * (Math.PI / 180);
}

function getDistanceFromLatLonInKm(lat1, lon1, lat2, lon2) {
  const R = 6371;

  const dLat = deg2rad(lat2 - lat1);
  const dLon = deg2rad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(deg2rad(lat1)) *
      Math.cos(deg2rad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
};

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
           host_details: true,
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
        },
      },

      // Active bookings
      bookings: {
        where: {
          status: {
            in: ["pending", "confirmed", "checked_in"],
          },
        },
        select: {
          check_in: true,
          check_out: true,
          status: true,
        },
        orderBy: {
          check_in: "asc",
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
      listing.latitude !== null && listing.longitude !== null
        ? {
            lat: Number(listing.latitude),
            lng: Number(listing.longitude),
          }
        : null,

    // blocked_dates is already returned because it is a scalar field
    blocked_dates: Array.isArray(listing.blocked_dates)
      ? listing.blocked_dates
      : [],
  };

  // Cache for 5 minutes
  await redisHelpers.set(cacheKey, responseListing, 300);

  return res.status(200).json({
    success: true,
    data: responseListing,
  });
});

// @desc    Update blocked dates for a listing
// @route   PATCH /api/v1/listings/:id/blocked-dates
// @access  Private (Host only)
// @desc    Update blocked dates for a listing
// @route   PATCH /api/v1/listings/:id/blocked-dates
// @access  Private (Host only)
const updateBlockedDates = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { blocked_dates } = req.body;

  console.log("========================================");
  console.log("📅 UPDATE BLOCKED DATES");
  console.log("📅 Listing ID:", id);
  console.log("📅 User ID:", req.user?.id);
  console.log("📅 Request body:", req.body);
  console.log("📅 blocked_dates:", blocked_dates);
  console.log("========================================");

  // =========================================================
  // VALIDATE INPUT
  // =========================================================

  if (!Array.isArray(blocked_dates)) {
    return res.status(400).json({
      success: false,
      message: "blocked_dates must be an array",
      code: "INVALID_BLOCKED_DATES",
    });
  }

  // =========================================================
  // CHECK LISTING OWNERSHIP
  // =========================================================

  const listing = await prisma.listing.findFirst({
    where: {
      id,
      host_id: req.user.id,
    },
    select: {
      id: true,
      host_id: true,
      blocked_dates: true,
    },
  });

  if (!listing) {
    return res.status(404).json({
      success: false,
      message: "Listing not found or you are not the owner",
      code: "LISTING_NOT_FOUND",
    });
  }

  // =========================================================
  // VALIDATE BLOCKED DATE OBJECTS
  // =========================================================

  const normalizedBlockedDates = [];

  for (const item of blocked_dates) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const startDate = item.startDate;
    const endDate = item.endDate;

    if (
      typeof startDate !== "string" ||
      typeof endDate !== "string"
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Each blocked date must contain startDate and endDate",
        code: "INVALID_BLOCKED_DATE",
      });
    }

    // YYYY-MM-DD validation
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(startDate) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(endDate)
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Dates must use YYYY-MM-DD format",
        code: "INVALID_DATE_FORMAT",
      });
    }

    // Convert to UTC dates for validation
    const start = new Date(`${startDate}T00:00:00.000Z`);
    const end = new Date(`${endDate}T00:00:00.000Z`);

    if (
      Number.isNaN(start.getTime()) ||
      Number.isNaN(end.getTime())
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid blocked date",
        code: "INVALID_DATE",
      });
    }

    if (start >= end) {
      return res.status(400).json({
        success: false,
        message:
          "endDate must be after startDate",
        code: "INVALID_DATE_RANGE",
      });
    }

    normalizedBlockedDates.push({
      id:
        typeof item.id === "string"
          ? item.id
          : crypto.randomUUID(),

      startDate,
      endDate,

      reason:
        typeof item.reason === "string" &&
        item.reason.trim()
          ? item.reason.trim()
          : "Blocked by host",
    });
  }

  console.log(
    "📅 Normalized blocked dates:",
    normalizedBlockedDates
  );

  // =========================================================
  // GET CONFIRMED / CHECKED-IN BOOKINGS
  // =========================================================

  const bookings = await prisma.booking.findMany({
    where: {
      listing_id: id,
      status: {
        in: ["confirmed", "checked_in"],
      },
    },
    select: {
      check_in: true,
      check_out: true,
      status: true,
    },
  });

  // =========================================================
  // CREATE SET OF BOOKED DATES
  // =========================================================

  const bookedDates = new Set();

  for (const booking of bookings) {
    const checkIn = new Date(booking.check_in);
    const checkOut = new Date(booking.check_out);

    let current = new Date(
      Date.UTC(
        checkIn.getUTCFullYear(),
        checkIn.getUTCMonth(),
        checkIn.getUTCDate()
      )
    );

    const checkout = new Date(
      Date.UTC(
        checkOut.getUTCFullYear(),
        checkOut.getUTCMonth(),
        checkOut.getUTCDate()
      )
    );

    while (current < checkout) {
      bookedDates.add(
        current.toISOString().split("T")[0]
      );

      current.setUTCDate(
        current.getUTCDate() + 1
      );
    }
  }

  console.log(
    "📅 Already booked dates:",
    [...bookedDates]
  );

  // =========================================================
  // CHECK BLOCKED RANGES AGAINST BOOKINGS
  // =========================================================

  const conflictingDates = [];

  for (const blocked of normalizedBlockedDates) {
    let current = new Date(
      `${blocked.startDate}T00:00:00.000Z`
    );

    const end = new Date(
      `${blocked.endDate}T00:00:00.000Z`
    );

    while (current < end) {
      const dateString =
        current.toISOString().split("T")[0];

      if (bookedDates.has(dateString)) {
        conflictingDates.push({
          date: dateString,
          blocked_range: {
            startDate: blocked.startDate,
            endDate: blocked.endDate,
          },
        });
      }

      current.setUTCDate(
        current.getUTCDate() + 1
      );
    }
  }

  // =========================================================
  // PREVENT CONFLICT
  // =========================================================

  if (conflictingDates.length > 0) {
    console.log(
      "❌ Blocked dates conflict with bookings:",
      conflictingDates
    );

    return res.status(400).json({
      success: false,
      message:
        "Some blocked dates overlap with a confirmed or checked-in booking",
      code: "DATES_ALREADY_BOOKED",
      conflicting_dates: conflictingDates,
    });
  }

  // =========================================================
  // SAVE TO DATABASE
  // =========================================================

  console.log(
    "💾 Saving blocked dates:",
    normalizedBlockedDates
  );

  const updatedListing =
    await prisma.listing.update({
      where: {
        id,
      },

      data: {
        blocked_dates: normalizedBlockedDates,
      },

      select: {
        id: true,
        blocked_dates: true,
        updated_at: true,
      },
    });

  // =========================================================
  // CLEAR CACHE
  // =========================================================

  await redisHelpers.del(`listing:${id}`);

  await redisHelpers.deletePattern(
    "listings:*"
  );

  console.log("✅ BLOCKED DATES SAVED");
  console.log(
    "📅 Saved:",
    updatedListing.blocked_dates
  );

  // =========================================================
  // RESPONSE
  // =========================================================

  return res.status(200).json({
    success: true,

    message:
      "Blocked dates updated successfully",

    data: {
      listing_id: updatedListing.id,

      blocked_dates:
        Array.isArray(
          updatedListing.blocked_dates
        )
          ? updatedListing.blocked_dates
          : [],

      updated_at:
        updatedListing.updated_at,
    },
  });
});
// @desc    Increment listing view count
// @route   POST /api/v1/listings/:id/view
// @access  Public
const incrementListingView = asyncHandler(async (req, res) => {
  const { id } = req.params;

  // Check that listing exists
  const listing = await prisma.listing.findUnique({
    where: {
      id,
    },
    select: {
      id: true,
      view_count: true,
    },
  });

  if (!listing) {
    return res.status(404).json({
      success: false,
      message: "Listing not found",
    });
  }

  // Increment view count
  const updatedListing = await prisma.listing.update({
    where: {
      id,
    },
    data: {
      view_count: {
        increment: 1,
      },
    },
    select: {
      id: true,
      view_count: true,
    },
  });

  // Clear cached listing because view_count changed
  await redisHelpers.del(`listing:${id}`);

  await redisHelpers.deletePattern("listings:*");

  return res.status(200).json({
    success: true,
    data: {
      listing_id: updatedListing.id,
      view_count: updatedListing.view_count,
    },
  });
});
// ============================================================
// DELETE SPECIFIC BLOCKED DATE
// DELETE /api/v1/listings/:listingId/blocked-dates/:blockedDateId
// ============================================================

const deleteBlockedDate = asyncHandler(async (req, res) => {
  const { listingId, blockedDateId } = req.params;
  const userId = req.user?.id;

  console.log("========================================");
  console.log("🗑️ DELETE BLOCKED DATE");
  console.log("🗑️ Listing ID:", listingId);
  console.log("🗑️ Blocked Date ID:", blockedDateId);
  console.log("🗑️ User ID:", userId);
  console.log("========================================");

  if (!listingId || !blockedDateId) {
    return res.status(400).json({
      success: false,
      message: "listingId and blockedDateId are required",
      code: "MISSING_PARAMETERS",
    });
  }

  if (!userId) {
    return res.status(401).json({
      success: false,
      message: "Authentication required",
      code: "UNAUTHORIZED",
    });
  }

  // Find listing belonging to logged-in host
  const listing = await prisma.listing.findFirst({
    where: {
      id: listingId,
      host_id: userId,
    },
    select: {
      id: true,
      host_id: true,
      blocked_dates: true,
    },
  });

  if (!listing) {
    return res.status(404).json({
      success: false,
      message: "Listing not found or you are not the owner",
      code: "LISTING_NOT_FOUND",
    });
  }

  const currentBlockedDates = Array.isArray(listing.blocked_dates)
    ? listing.blocked_dates
    : [];

  console.log("📅 Current blocked dates:", currentBlockedDates);

  // Find exact blocked date
  const blockedDate = currentBlockedDates.find(
    (item) =>
      item &&
      typeof item === "object" &&
      String(item.id) === String(blockedDateId)
  );

  if (!blockedDate) {
    return res.status(404).json({
      success: false,
      message: "Blocked date not found",
      code: "BLOCKED_DATE_NOT_FOUND",
    });
  }

  console.log("🎯 Removing blocked date:", blockedDate);

  // Remove ONLY this blocked date
  const updatedBlockedDates = currentBlockedDates.filter(
    (item) =>
      !(
        item &&
        typeof item === "object" &&
        String(item.id) === String(blockedDateId)
      )
  );

  // Save
  const updatedListing = await prisma.listing.update({
    where: {
      id: listingId,
    },
    data: {
      blocked_dates: updatedBlockedDates,
    },
    select: {
      id: true,
      blocked_dates: true,
      updated_at: true,
    },
  });

  // Clear caches
  await redisHelpers.del(`listing:${listingId}`);
  await redisHelpers.deletePattern("listings:*");

  console.log("✅ BLOCKED DATE DELETED");
  console.log(
    "📅 Remaining blocked dates:",
    updatedListing.blocked_dates
  );

  return res.status(200).json({
    success: true,
    message: "Blocked date deleted successfully",
    data: {
      listing_id: updatedListing.id,
      deleted_blocked_date: blockedDate,
      blocked_dates: Array.isArray(updatedListing.blocked_dates)
        ? updatedListing.blocked_dates
        : [],
      updated_at: updatedListing.updated_at,
    },
  });
});

// ============================================================
// GET NEARBY LISTINGS
// GET /api/v1/listings/nearby
//
// Query:
// ?lat=32.8872
// &lng=13.1913
// &radius=50
// &limit=20
// &category=beachfront
// ============================================================

const getNearbyListings = asyncHandler(async (req, res) => {
  try {
    const lat = parseFloat(req.query.lat);
    const lng = parseFloat(req.query.lng);
    const radius = parseFloat(req.query.radius) || 50;
    const limit = parseInt(req.query.limit, 10) || 20;
    const category = req.query.category;

    // ========================================================
    // VALIDATE COORDINATES
    // ========================================================

    if (
      Number.isNaN(lat) ||
      Number.isNaN(lng) ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lng)
    ) {
      return res.status(400).json({
        success: false,
        error: "Invalid coordinates",
      });
    }

    // Validate latitude / longitude ranges
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return res.status(400).json({
        success: false,
        error: "Invalid latitude or longitude",
      });
    }

    // Prevent unreasonable values
    const safeRadius = Math.min(Math.max(radius, 1), 500);
    const safeLimit = Math.min(Math.max(limit, 1), 100);

    // ========================================================
    // WHERE CONDITIONS
    // ========================================================

    let whereConditions = `
      l.status = 'active'
      AND l.latitude IS NOT NULL
      AND l.longitude IS NOT NULL
      AND u.status = 'confirmed'
      AND u.role = 'host'
    `;

    const queryParams = [];
    let paramIndex = 1;

    // ========================================================
    // CATEGORY FILTER
    // ========================================================

    if (category && category !== "all") {
      whereConditions += ` AND l.category = $${paramIndex}`;
      queryParams.push(category);
      paramIndex++;
    }

    // ========================================================
    // BOUNDING BOX
    //
    // This reduces the number of listings that need the
    // expensive Haversine calculation.
    // ========================================================

    const degreesPerKm = 0.009;

    const latDelta = safeRadius * degreesPerKm;

    // Prevent division problems near the poles
    const cosLat = Math.cos((lat * Math.PI) / 180);

    const lngDelta =
      safeRadius *
      degreesPerKm /
      Math.max(Math.abs(cosLat), 0.01);

    const latParam = paramIndex;
    const lngParam = paramIndex + 1;
    const latDeltaParam = paramIndex + 2;
    const lngDeltaParam = paramIndex + 3;

    const bboxQuery = `
      SELECT
        l.id,
        l.title,
        l.description,
        l.price,
        l.location,
        l.latitude,
        l.longitude,
        l.images,
        l.category,
        l.amenities,
        l.created_at,

        u.name AS host_name,
        u.status AS host_status

      FROM listings l

      JOIN users u
        ON l.host_id = u.id

      WHERE ${whereConditions}

        AND l.latitude BETWEEN
          $${latParam}::float - $${latDeltaParam}::float
          AND
          $${latParam}::float + $${latDeltaParam}::float

        AND l.longitude BETWEEN
          $${lngParam}::float - $${lngDeltaParam}::float
          AND
          $${lngParam}::float + $${lngDeltaParam}::float
    `;

    queryParams.push(
      lat,
      lng,
      latDelta,
      lngDelta
    );

    // ========================================================
    // DATABASE QUERY
    // ========================================================

    const result = await prisma.$queryRawUnsafe(
      bboxQuery,
      ...queryParams
    );

    // ========================================================
    // CALCULATE EXACT DISTANCE
    // ========================================================

    const listings = result
      .map((listing) => {
        const listingLat = parseFloat(listing.latitude);
        const listingLng = parseFloat(listing.longitude);

        const distance = getDistanceFromLatLonInKm(
          lat,
          lng,
          listingLat,
          listingLng
        );

        return {
          ...listing,

          distance_km:
            Math.round(distance * 10) / 10,
        };
      })

      .filter(
        (listing) =>
          listing.distance_km <= safeRadius
      )

      .sort(
        (a, b) =>
          a.distance_km - b.distance_km
      )

      .slice(0, safeLimit);

    // ========================================================
    // FORMAT RESPONSE
    // ========================================================

    const formattedListings = listings.map(
      (listing) => ({
        id: listing.id,

        title: listing.title,

        description:
          listing.description,

        price: listing.price,

        location:
          listing.location,

        coordinates: {
          lat: parseFloat(
            listing.latitude
          ),

          lng: parseFloat(
            listing.longitude
          ),
        },

        images:
          Array.isArray(listing.images)
            ? listing.images
            : [],

        category:
          listing.category,

        amenities:
          Array.isArray(listing.amenities)
            ? listing.amenities
            : [],

        createdAt:
          listing.created_at,

        hostName:
          listing.host_name,

        hostStatus:
          listing.host_status,

        distance:
          listing.distance_km,
      })
    );

    // ========================================================
    // RESPONSE
    // ========================================================

    return res.status(200).json({
      success: true,

      center: {
        lat,
        lng,
      },

      radius: safeRadius,

      count:
        formattedListings.length,

      listings:
        formattedListings,

      filters: {
        category:
          category || "all",

        limit:
          safeLimit,
      },
    });
  } catch (error) {
    console.error(
      "❌ Nearby listings error:",
      error
    );

    return res.status(500).json({
      success: false,

      error:
        "Internal server error",

      message:
        process.env.NODE_ENV === "development"
          ? error.message
          : undefined,
    });
  }
});

module.exports = {
  createListing,
  getListings,
  getListing,
  updateListing,
  deleteListing,
  getHostListings,
  toggleListingActive,
  getListingForUser,
  updateBlockedDates,
  incrementListingView,
  deleteBlockedDate,
  getNearbyListings
};
