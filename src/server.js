const dotenv = require('dotenv');
const path = require('path');

// Load .env from root
dotenv.config({ path: path.join(__dirname, '..', '.env') });


console.log('📦 Loading application...');
console.log(`🔧 Environment: ${process.env.NODE_ENV || 'development'}`);

const app = require('./app');
const { checkDatabaseConnection, disconnectDatabase } = require('./config/database');
const { redis } = require('./config/redis');

const PORT = process.env.PORT || 5000;
console.log(`📍 Port: ${PORT}`);

let server;

const startServer = async () => {
  try {
    console.log('🔄 Checking database connection...');
    
    // Check database connection
    const dbConnected = await checkDatabaseConnection();
    if (!dbConnected) {
      console.error('❌ Failed to connect to database. Exiting...');
      process.exit(1);
    }

    console.log('✅ Database connected successfully');

    // Start server - bind to 0.0.0.0 for Render
    server = app.listen(PORT, '0.0.0.0', () => {
      console.log(`
🚀 Server started successfully!
📡 Environment: ${process.env.NODE_ENV || 'development'}
🔗 URL: http://localhost:${PORT}
🔗 Public URL: http://0.0.0.0:${PORT}
⏰ Started at: ${new Date().toISOString()}
      `);
    });

    // Handle server errors
    server.on('error', (error) => {
      console.error('❌ Server error:', error);
      if (error.code === 'EADDRINUSE') {
        console.error(`❌ Port ${PORT} is already in use`);
      }
      process.exit(1);
    });

    // Graceful shutdown
    const shutdown = async (signal) => {
      console.log(`\n⚠️ Received ${signal}. Shutting down gracefully...`);
      
      if (server) {
        server.close(async (err) => {
          if (err) {
            console.error('❌ Error closing server:', err);
          } else {
            console.log('🔌 HTTP server closed');
          }
          
          try {
            // Disconnect database
            await disconnectDatabase();
            console.log('✅ Database disconnected');
          } catch (dbError) {
            console.error('❌ Error disconnecting database:', dbError);
          }
          
          try {
            // Quit Redis
            await redis.quit();
            console.log('✅ Redis disconnected');
          } catch (redisError) {
            console.error('❌ Error disconnecting Redis:', redisError);
          }
          
          console.log('👋 Shutdown complete');
          process.exit(0);
        });
      } else {
        process.exit(0);
      }
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

  } catch (error) {
    console.error('❌ Failed to start server:', error);
    console.error('📋 Error details:', error.stack);
    process.exit(1);
  }
};

// Handle unhandled rejections
process.on('unhandledRejection', (error) => {
  console.error('❌ Unhandled Rejection:', error);
  console.error('📋 Stack:', error.stack);
  process.exit(1);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  console.error('📋 Stack:', error.stack);
  process.exit(1);
});

// Start the server
startServer();