
const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcrypt");

const prisma = new PrismaClient();

async function seedSuperAdmin() {
  try {
    const name = process.env.ADMIN_NAME?.trim();
    const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
    const password = process.env.ADMIN_PASSWORD;

    if (!name || !email || !password) {
      throw new Error(
        "ADMIN_NAME, ADMIN_EMAIL, and ADMIN_PASSWORD are required."
      );
    }

    if (password.length < 12) {
      throw new Error("Admin password must be at least 12 characters.");
    }

    console.log("Creating Super Admin...");

    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      throw new Error(
        `An account with ${email} already exists. No changes were made.`
      );
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const admin = await prisma.user.create({
      data: {
        name,
        email,
        password_hash: passwordHash,

        account_type: "super_admin",
        role: "admin",
        status: "confirmed",

        email_verified_at: new Date(),
        auth_version: 0,
        deleted_at: null,
      },
      select: {
        id: true,
        name: true,
        email: true,
        account_type: true,
        role: true,
        status: true,
        created_at: true,
      },
    });

    console.log("Super Admin created successfully:");
    console.log(admin);
  } catch (error) {
    console.error("Seed failed:", error.message);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

seedSuperAdmin();
