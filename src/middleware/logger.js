// src/middleware/logger.js
const logger = (req, res, next) => {
  console.log('📥 Incoming Request:');
  console.log('  Method:', req.method);
  console.log('  URL:', req.url);
  console.log('  Headers:', {
    'content-type': req.headers['content-type'],
    'user-agent': req.headers['user-agent'],
    'origin': req.headers['origin'],
  });
  console.log('  Body:', req.body);
  console.log('  Query:', req.query);
  console.log('  Params:', req.params);
  next();
};

module.exports = logger;