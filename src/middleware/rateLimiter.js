const rateLimit = require('express-rate-limit');
const { redis } = require('../config/redis');

// Redis store for rate limiting
const RedisStore = require('rate-limit-redis');

// General rate limiter
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: {
    success: false,
    message: 'Too many requests, please try again later',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Auth rate limiter (stricter)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Limit each IP to 10 requests per windowMs
  message: {
    success: false,
    message: 'Too many authentication attempts, please try again later',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// API rate limiter with Redis
const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60, // 60 requests per minute
  store: new RedisStore({
    sendCommand: (...args) => redis.call(...args),
    prefix: 'rate-limit:',
  }),
  message: {
    success: false,
    message: 'Too many requests, please slow down',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Listing creation rate limiter
const listingLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000, // 24 hours
  max: 10, // 10 listings per day
  message: {
    success: false,
    message: 'Too many listings created, please try again tomorrow',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = {
  generalLimiter,
  authLimiter,
  apiLimiter,
  listingLimiter,
};