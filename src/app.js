// src/app.js
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const compression = require("compression");
const morgan = require("morgan");
const path = require("path");

const { generalLimiter, apiLimiter } = require("./middleware/rateLimiter");
const { errorHandler, notFound } = require("./middleware/errorHandler");
const sanitizeMiddleware = require("./middleware/sanitizeMiddleware"); // ✅ ADDED

const authRoutes = require("./routes/authRoutes");
const listingRoutes = require("./routes/listingRoutes");
const bookingRoutes = require("./routes/bookingRoutes");
const AdminRoutes = require("./routes/adminRoutes");
const databaseRoutes = require("./routes/databaseRoutes");
const hostBlockedUserRoutes = require("./routes/hostBlockedUserRoutes");
const statsRoutes = require("./routes/statsRoutes");
const moamalatRoutes = require("./routes/moamalatRoutes");
const uploadRoutes = require("./routes/uploadRoutes");

const app = express();

// ---------------------------------------------------------------------------
// 1) Trust proxy FIRST (before anything reads req.ip or x-forwarded-for)
// ---------------------------------------------------------------------------
app.set("trust proxy", 1);

// ---------------------------------------------------------------------------
// 2) Security headers
// ---------------------------------------------------------------------------
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
  }),
);

// ---------------------------------------------------------------------------
// 3) CORS
// ---------------------------------------------------------------------------
const allowedOrigins = [
  "https://mar-haba.ly",
  "https://www.mar-haba.ly",
  "https://dashboard.mar-haba.ly",
  process.env.FRONTEND_URL,
].filter(Boolean);

const corsOptions = {
  origin(origin, callback) {
    // Non-browser clients (Postman, mobile, server-to-server) send no Origin.
    if (!origin) return callback(null, true);

    const isLocalhost =
      /^http:\/\/localhost(:\d+)?$/.test(origin) ||
      /^http:\/\/127\.0\.0\.1(:\d+)?$/.test(origin);

    if (isLocalhost || allowedOrigins.includes(origin)) {
      if (process.env.NODE_ENV === "development") {
        // eslint-disable-next-line no-console
        console.log("✅ CORS allowed:", origin);
      }
      return callback(null, true);
    }

    if (process.env.NODE_ENV === "development") {
      // eslint-disable-next-line no-console
      console.log("❌ CORS blocked:", origin);
    }

    // Return an explicit 403 instead of a generic 500 via errorHandler.
    const err = new Error(`Not allowed by CORS: ${origin}`);
    err.status = 403;
    err.code = "CORS_FORBIDDEN";
    return callback(err);
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "X-Requested-With",
    "Accept",
    "Origin",
  ],
  optionsSuccessStatus: 204,
};

app.use(cors(corsOptions));

// ---------------------------------------------------------------------------
// 4) Compression
// ---------------------------------------------------------------------------
app.use(compression());

// ---------------------------------------------------------------------------
// 5) Body parsing — BEFORE sanitizer
// ---------------------------------------------------------------------------
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

// ---------------------------------------------------------------------------
// 6) Sanitization — MUST run AFTER body parsing
//    Escapes HTML in JSON bodies (blocks stored XSS), strips control
//    chars from query/params. Prisma already parameterizes SQL, so SQL
//    injection is structurally prevented at the ORM layer.
// ---------------------------------------------------------------------------
app.use(sanitizeMiddleware);

// ---------------------------------------------------------------------------
// 7) Static files
//    NOTE: only serve PUBLIC upload subfolders. Private user documents
//    (IDs, receipts) should NOT live under public/ — serve them via an
//    authenticated route instead.
// ---------------------------------------------------------------------------
app.use(
  "/uploads",
  express.static(path.join(__dirname, "..", "public", "uploads"), {
    index: false,
    maxAge: "7d",
  }),
);

// ---------------------------------------------------------------------------
// 8) Logging
// ---------------------------------------------------------------------------
app.use(morgan(process.env.NODE_ENV === "development" ? "dev" : "combined"));

// ---------------------------------------------------------------------------
// 9) Rate limiting (re-enabled)
// ---------------------------------------------------------------------------
app.use(generalLimiter);
app.use("/api", apiLimiter);

// ---------------------------------------------------------------------------
// 10) Health check
// ---------------------------------------------------------------------------
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || "development",
    // Do not expose the internal port in production.
    ...(process.env.NODE_ENV === "development" && {
      port: process.env.PORT || 5000,
    }),
  });
});

// ---------------------------------------------------------------------------
// 11) API routes
// ---------------------------------------------------------------------------
app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/listings", listingRoutes);
app.use("/api/v1/bookings", bookingRoutes);
app.use("/api/v1/dashboard", AdminRoutes);
app.use("/api/v1/uploads", uploadRoutes);
app.use("/api/v1/database", databaseRoutes);
app.use("/api/v1/host", hostBlockedUserRoutes);
app.use("/api/v1/stats", statsRoutes);
app.use("/api/v1/payments", moamalatRoutes);

// ---------------------------------------------------------------------------
// 12) Root route
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// 13) Fallbacks
// ---------------------------------------------------------------------------
app.use(notFound);
app.use(errorHandler);

module.exports = app;