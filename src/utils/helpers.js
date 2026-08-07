const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

// Generate random token
const generateToken = (length = 32) => {
  return crypto.randomBytes(length).toString('hex');
};

// Generate OTP
const generateOTP = (length = 6) => {
  return Math.floor(Math.random() * (10 ** length - 1) + 10 ** (length - 1)).toString();
};

// Calculate booking total price
const calculateBookingPrice = (listingPrice, checkIn, checkOut, guests = 1) => {
  const nights = Math.ceil((new Date(checkOut) - new Date(checkIn)) / (1000 * 60 * 60 * 24));
  return parseFloat((listingPrice * nights * guests).toFixed(2));
};

// Check date overlap
const datesOverlap = (start1, end1, start2, end2) => {
  return new Date(start1) < new Date(end2) && new Date(start2) < new Date(end1);
};

// Format date for display
const formatDate = (date, format = 'YYYY-MM-DD') => {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  
  if (format === 'YYYY-MM-DD') {
    return `${year}-${month}-${day}`;
  }
  return d.toLocaleDateString();
};

// Calculate host rating
const calculateHostRating = (bookings) => {
  if (!bookings || bookings.length === 0) return 0;
  const totalRating = bookings.reduce((sum, b) => sum + (b.rating || 0), 0);
  return parseFloat((totalRating / bookings.length).toFixed(1));
};

// Filter listings by date availability
const filterAvailableListings = (listings, checkIn, checkOut) => {
  return listings.filter(listing => {
    const blockedDates = listing.blocked_dates || [];
    const isBlocked = blockedDates.some(block => {
      const blockStart = new Date(block.start);
      const blockEnd = new Date(block.end);
      return datesOverlap(checkIn, checkOut, blockStart, blockEnd);
    });
    
    if (isBlocked) return false;
    
    // Check if listing has bookings during this period
    const hasBooking = listing.bookings.some(booking => {
      if (!['confirmed', 'pending'].includes(booking.status)) return false;
      return datesOverlap(checkIn, checkOut, booking.check_in, booking.check_out);
    });
    
    return !hasBooking;
  });
};

// Mask sensitive data
const maskSensitiveData = (data) => {
  if (data.email) {
    const [name, domain] = data.email.split('@');
    data.email = `${name.slice(0, 2)}***@${domain}`;
  }
  if (data.phone_number) {
    data.phone_number = data.phone_number.slice(0, -4).replace(/./g, '*') + data.phone_number.slice(-4);
  }
  return data;
};

// Pagination helper
const paginate = (page = 1, limit = 10) => {
  const pageNumber = parseInt(page, 10);
  const limitNumber = parseInt(limit, 10);
  const skip = (pageNumber - 1) * limitNumber;
  return { skip, take: limitNumber, page: pageNumber, limit: limitNumber };
};

// Generate pagination metadata
const paginationMeta = (total, page, limit) => {
  const totalPages = Math.ceil(total / limit);
  return {
    total,
    page,
    limit,
    totalPages,
    hasNext: page < totalPages,
    hasPrev: page > 1,
  };
};

// Sanitize search query
const sanitizeSearch = (query) => {
  return query
    .trim()
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\s+/g, ' ')
    .toLowerCase();
};

// Generate unique slug
const generateSlug = (text) => {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 50);
};

// Sleep (for testing)
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Retry function
const retry = async (fn, retries = 3, delay = 1000) => {
  try {
    return await fn();
  } catch (error) {
    if (retries === 0) throw error;
    await sleep(delay);
    return retry(fn, retries - 1, delay * 2);
  }
};

// Parse JSON safely
const safeJSONParse = (json, fallback = null) => {
  try {
    return JSON.parse(json);
  } catch {
    return fallback;
  }
};

module.exports = {
  generateToken,
  generateOTP,
  calculateBookingPrice,
  datesOverlap,
  formatDate,
  calculateHostRating,
  filterAvailableListings,
  maskSensitiveData,
  paginate,
  paginationMeta,
  sanitizeSearch,
  generateSlug,
  sleep,
  retry,
  safeJSONParse,
};