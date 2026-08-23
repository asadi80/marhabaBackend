const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const path = require("path");
const compression = require("compression");
const morgan = require("morgan");
const { generalLimiter, apiLimiter } = require("./middleware/rateLimiter");
const { errorHandler, notFound } = require("./middleware/errorHandler");
const uploadRoutes = require("./routes/uploadRoutes");

// Import routes
const authRoutes = require("./routes/authRoutes");
const listingRoutes = require("./routes/listingRoutes");
const bookingRoutes = require("./routes/bookingRoutes");
const AdminRoutes = require('./routes/adminRoutes')

const app = express();
const logger = require("./middleware/logger");

// This tells Express to trust the X-Forwarded-* headers
app.set("trust proxy", 1); // Trust first proxy

// Security middleware
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
  }),
);

// ✅ FIXED: CORS Configuration - Remove the problematic app.options('*')
const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);

    // List of allowed origins
    const allowedOrigins = [
      "http://localhost:5173",
      "http://localhost:3000",
      "https://mar-haba.ly",
      "https://www.mar-haba.ly",
      process.env.FRONTEND_URL,
    ].filter(Boolean);

    // Check if origin is allowed
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      console.log("❌ Blocked origin:", origin);
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true,
  optionsSuccessStatus: 200,
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "X-Requested-With",
    "Accept",
  ],
};

// Apply CORS middleware - this handles preflight requests automatically
app.use(cors(corsOptions));

// ❌ REMOVE THIS LINE - it's causing the error:
// app.options('*', cors(corsOptions));

// Compression
app.use(compression());

// Body parsing
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
// Uploaded files
app.use("/uploads", express.static("public/uploads"));
// Logging
if (process.env.NODE_ENV === "development") {
  app.use(morgan("dev"));
} else {
  app.use(morgan("combined"));
}

// Rate limiting
app.use(generalLimiter);
app.use("/api", apiLimiter);

// Health check (important for Render)
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || "development",
    port: process.env.PORT || 5000,
  });
});

// API routes
app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/listings", listingRoutes);
app.use("/api/v1/bookings", bookingRoutes);
app.use("/api/v1/dashboard", AdminRoutes);
app.use("/api/v1/uploads", uploadRoutes);
// Root route
app.get("/", (req, res) => {
  res.status(200).json({
    name: "Marhaba MVP Backend API",
    version: "1.0.0",
    status: "operational",
    endpoints: {
      auth: "/api/v1/auth",
      listings: "/api/v1/listings",
      bookings: "/api/v1/bookings",
      dashboard: "/api/v1/dashboard",
      health: "/health",
    },
  });
});

// 404 handler
app.use(notFound);

// Error handler
app.use(errorHandler);

module.exports = app;
