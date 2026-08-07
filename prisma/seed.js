const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcrypt");

const prisma = new PrismaClient();

async function resetAndSeed() {
  try {
    console.log("🔄 Resetting database and seeding admin...");

    // Step 1: Delete all data in correct order (respect foreign keys)
    console.log("🗑️  Deleting all existing data...");

    await prisma.bookingPayment.deleteMany({});
    await prisma.hostBlockedUser.deleteMany({});
    await prisma.hostPaymentMethod.deleteMany({});
    await prisma.booking.deleteMany({});
    await prisma.userSession.deleteMany({});
    await prisma.userEvent.deleteMany({});
    await prisma.listing.deleteMany({});
    await prisma.user.deleteMany({});

    console.log("✅ All data cleared!");

    // Step 2: Create super admin
    console.log("👤 Creating super admin...");

    const admin = await prisma.user.create({
      data: {
        name: "Abdurraouf Sadi",
        email: "abdurraouf@mar-haba.ly",
        password_hash: await bcrypt.hash("Abdo1702*)", 10),
        phone_number: "+218910000001",
        role: "super_admin",
        status: "confirmed",
        email_verified: true,
      },
    });

    console.log("✅ Super admin created:", admin.email);
    console.log("🎉 Done!");

  } catch (error) {
    console.error("❌ Error:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

resetAndSeed();