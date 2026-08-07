const dotenv = require('dotenv');
dotenv.config();

const app = require('./src/app');
const { checkDatabaseConnection, disconnectDatabase } = require('./src/config/database');
const { redis } = require('./src/config/redis');

const PORT = process.env.PORT || 5000;

let server;

const startServer = async () => {
  try {
    // Check database connection
    const dbConnected = await checkDatabaseConnection();
    if (!dbConnected) {
      console.error('❌ Failed to connect to database. Exiting...');
      process.exit(1);
    }

    // Start server
    server = app.listen(PORT, () => {
      console.log(`
🚀 Server started successfully!
📡 Environment: ${process.env.NODE_ENV}
🔗 URL: http://localhost:${PORT}
⏰ Started at: ${new Date().toISOString()}
      `);
    });

    // Graceful shutdown
    const shutdown = async (signal) => {
      console.log(`\n⚠️ Received ${signal}. Shutting down gracefully...`);
      
      if (server) {
        server.close(async () => {
          console.log('🔌 HTTP server closed');
          
          // Disconnect database
          await disconnectDatabase();
          
          // Quit Redis
          await redis.quit();
          console.log('🔌 Redis disconnected');
          
          console.log('👋 Shutdown complete');
          process.exit(0);
        });
      }
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
};

// Handle unhandled rejections
process.on('unhandledRejection', (error) => {
  console.error('❌ Unhandled Rejection:', error);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  process.exit(1);
});

startServer();