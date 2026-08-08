const { PrismaClient } = require('@prisma/client');

// Prisma Client with connection pooling
const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
//   datasources: {
//     db: {
//       url: process.env.DATABASE_URL,
//     },
//   },
});

// Connection health check
const checkDatabaseConnection = async () => {
  try {
    await prisma.$connect();
    console.log('✅ PostgreSQL Connected Successfully');
    return true;
  } catch (error) {
    console.error('❌ Database Connection Failed:', error.message);
    return false;
  }
};

// Graceful shutdown
const disconnectDatabase = async () => {
  await prisma.$disconnect();
  console.log('🔌 Database Disconnected');
};

module.exports = { prisma, checkDatabaseConnection, disconnectDatabase };