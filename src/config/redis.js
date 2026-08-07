const Redis = require('ioredis');

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  retryStrategy: (times) => {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
  maxRetriesPerRequest: 3,
});

redis.on('connect', () => {
  console.log('✅ Redis Connected Successfully');
});

redis.on('error', (error) => {
  console.error('❌ Redis Connection Error:', error.message);
});

// Redis helper functions
const redisHelpers = {
  // Set with expiry (default 1 hour)
  set: async (key, value, expiry = 3600) => {
    return redis.set(key, JSON.stringify(value), 'EX', expiry);
  },
  
  // Get with fallback
  get: async (key) => {
    const data = await redis.get(key);
    return data ? JSON.parse(data) : null;
  },
  
  // Delete
  del: async (key) => redis.del(key),
  
  // Clear pattern
  deletePattern: async (pattern) => {
    const keys = await redis.keys(pattern);
    if (keys.length > 0) {
      return redis.del(keys);
    }
    return 0;
  },
  
  // Increment view count
  incrementView: async (key) => redis.incr(key),
  
  // Get TTL
  ttl: async (key) => redis.ttl(key),
};

module.exports = { redis, redisHelpers };