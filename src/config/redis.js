const Redis = require('ioredis');

let redis;
let redisConnected = false;

// Only connect if REDIS_URL is provided
if (process.env.REDIS_URL) {
  try {
    redis = new Redis(process.env.REDIS_URL, {
      retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
      maxRetriesPerRequest: 3,
    });

    redis.on('connect', () => {
      redisConnected = true;
      console.log('✅ Redis Connected Successfully');
    });

    redis.on('error', (error) => {
      redisConnected = false;
      console.error('❌ Redis Connection Error:', error.message);
    });
  } catch (error) {
    console.error('❌ Redis initialization failed:', error.message);
    redis = null;
  }
} else {
  console.log('ℹ️ Redis URL not provided, running without Redis');
  redis = null;
}

// Redis helpers with fallback
const redisHelpers = {
  set: async (key, value, expiry = 3600) => {
    if (!redis || !redisConnected) return null;
    try {
      return redis.set(key, JSON.stringify(value), 'EX', expiry);
    } catch (error) {
      console.error('❌ Redis set error:', error.message);
      return null;
    }
  },
  
  get: async (key) => {
    if (!redis || !redisConnected) return null;
    try {
      const data = await redis.get(key);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      console.error('❌ Redis get error:', error.message);
      return null;
    }
  },
  
  del: async (key) => {
    if (!redis || !redisConnected) return null;
    try {
      return redis.del(key);
    } catch (error) {
      console.error('❌ Redis del error:', error.message);
      return null;
    }
  },
  
  deletePattern: async (pattern) => {
    if (!redis || !redisConnected) return 0;
    try {
      const keys = await redis.keys(pattern);
      if (keys.length > 0) {
        return redis.del(keys);
      }
      return 0;
    } catch (error) {
      console.error('❌ Redis deletePattern error:', error.message);
      return 0;
    }
  },
};

module.exports = { redis, redisHelpers, redisConnected };