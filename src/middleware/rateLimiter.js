// middleware/rateLimiter.js
const rateLimit = require("express-rate-limit");

// Every message includes `code` so the frontend can switch on it
// the same way it does for controller errors.
const limitedResponse = (message, code) => ({
  success: false,
  code,
  message,
});

// General limiter — mounted globally in app.js
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: limitedResponse(
    "Too many requests, please try again later",
    "RATE_LIMITED",
  ),
  standardHeaders: true,
  legacyHeaders: false,
});

// Strict — anonymous auth attempts only (login/register/reset).
// Do NOT apply to /me, /logout, or any authenticated read.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: limitedResponse(
    "Too many authentication attempts, please try again later",
    "AUTH_RATE_LIMITED",
  ),
  standardHeaders: true,
  legacyHeaders: false,
});

// Refresh — called automatically by the client on token expiry,
// so the budget is higher. Still bounded to stop refresh-storms.
const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60, // ~4 per minute average — plenty for legitimate clients
  message: limitedResponse(
    "Too many token refresh attempts, please try again later",
    "REFRESH_RATE_LIMITED",
  ),
  standardHeaders: true,
  legacyHeaders: false,
});

// API limiter — mounted under /api in app.js
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: limitedResponse(
    "Too many requests, please slow down",
    "RATE_LIMITED",
  ),
  standardHeaders: true,
  legacyHeaders: false,
});

// Listing creation — apply in listingRoutes.js on POST /
const listingLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  max: 10,
  message: limitedResponse(
    "Too many listings created, please try again tomorrow",
    "LISTING_RATE_LIMITED",
  ),
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = {
  generalLimiter,
  authLimiter,
  refreshLimiter,
  apiLimiter,
  listingLimiter,
};