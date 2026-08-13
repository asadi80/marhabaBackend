//src/middleware/validation.js
const { body, param, query, validationResult } = require("express-validator");

// Validation result handler
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);

  if (!errors.isEmpty()) {
    console.log(
      "❌ Validation Errors:",
      JSON.stringify(errors.array(), null, 2),
    );

    return res.status(400).json({
      success: false,
      message: "Validation failed",
      errors: errors.array().map((err) => ({
        field: err.param,
        message: err.msg,
        value: err.value,
      })),
    });
  }
  next();
};

// Common validators
const commonValidators = {
  // ID validator
  id: (field = "id") =>
    param(field)
      .notEmpty()
      .withMessage(`${field} is required`)
      .isUUID()
      .withMessage(`Invalid ${field} format`),

  // Pagination validator
  pagination: [
    query("page")
      .optional()
      .isInt({ min: 1 })
      .withMessage("Page must be a positive integer")
      .toInt(),
    query("limit")
      .optional()
      .isInt({ min: 1, max: 100 })
      .withMessage("Limit must be between 1-100")
      .toInt(),
  ],

  // Search validator
  search: [
    query("search")
      .optional()
      .trim()
      .isLength({ max: 100 })
      .withMessage("Search term too long"),
    query("sort")
      .optional()
      .isIn(["asc", "desc"])
      .withMessage("Sort must be asc or desc"),
  ],
};

// User validators
const userValidators = {
  register: [
    body("name")
      .trim()
      .notEmpty()
      .withMessage("Name is required")
      .isLength({ min: 2, max: 100 })
      .withMessage("Name must be 2-100 characters"),

    body("email")
      .trim()
      .notEmpty()
      .withMessage("Email is required")
      .isEmail()
      .withMessage("Invalid email format")
      .normalizeEmail()
      .toLowerCase(),

    body("password")
      .notEmpty()
      .withMessage("Password is required")
      .isLength({ min: 6 })
      .withMessage("Password must be at least 8 characters")
      .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
      .withMessage("Password must contain uppercase, lowercase, and number"),

    body("phone_number")
      .trim()
      .notEmpty()
      .withMessage("Phone number is required")
      .matches(/^\+?[1-9]\d{1,14}$/)
      .withMessage("Invalid phone number format"),

    body("role").optional().isIn(["user", "host"]).withMessage("Invalid role"),
  ],

  login: [
    body("email")
      .trim()
      .notEmpty()
      .withMessage("Email is required")
      .isEmail()
      .withMessage("Invalid email format")
      .normalizeEmail(),

    body("password").notEmpty().withMessage("Password is required"),
  ],

  updateProfile: [
    body("name")
      .optional()
      .trim()
      .isLength({ min: 2, max: 100 })
      .withMessage("Name must be 2-100 characters"),

    body("phone_number")
      .optional()
      .trim()
      .matches(/^\+?[1-9]\d{1,14}$/)
      .withMessage("Invalid phone number format"),
  ],
};

// Listing validators
const listingValidators = {
  create: [
    body("title")
      .trim()
      .notEmpty()
      .withMessage("Title is required")
      .isLength({ min: 5, max: 255 })
      .withMessage("Title must be 5-255 characters"),

    body("description")
      .trim()
      .notEmpty()
      .withMessage("Description is required")
      .isLength({ min: 20, max: 5000 })
      .withMessage("Description must be 20-5000 characters"),

    body("price")
      .notEmpty()
      .withMessage("Price is required")
      .isFloat({ min: 0.01 })
      .withMessage("Price must be positive"),

    body("location").trim().notEmpty().withMessage("Location is required"),

    body("category")
      .optional()
      .isIn(["city", "mountain", "beach", "countryside"])
      .withMessage("Invalid category"),

    body("amenities")
      .optional()
      .isArray()
      .withMessage("Amenities must be an array"),

    body("cancellation_policy")
      .optional()
      .isIn(["flexible", "moderate", "strict"])
      .withMessage("Invalid cancellation policy"),
  ],

  update: [
    body("title")
      .optional()
      .trim()
      .isLength({ min: 5, max: 255 })
      .withMessage("Title must be 5-255 characters"),

    body("price")
      .optional()
      .isFloat({ min: 0.01 })
      .withMessage("Price must be positive"),

    body("status")
      .optional()
      .isIn(["active", "inactive"])
      .withMessage("Invalid status"),
  ],
};

// Booking validators
const bookingValidators = {
  create: [
    body("check_in")
      .notEmpty()
      .withMessage("Check-in date is required")
      .isISO8601()
      .withMessage("Invalid date format")
      .custom((value) => {
        const date = new Date(value);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        return date >= today;
      })
      .withMessage("Check-in must be today or future"),

    body("check_out")
      .notEmpty()
      .withMessage("Check-out date is required")
      .isISO8601()
      .withMessage("Invalid date format")
      .custom((value, { req }) => {
        const checkOut = new Date(value);
        const checkIn = new Date(req.body.check_in);
        return checkOut > checkIn;
      })
      .withMessage("Check-out must be after check-in"),

    body("guests")
      .optional()
      .isInt({ min: 1, max: 20 })
      .withMessage("Guests must be 1-20"),
  ],

  status: [
    body("status")
      .notEmpty()
      .withMessage("Status is required")
      .isIn(["confirmed", "cancelled"])
      .withMessage("Invalid status"),
  ],
};

// Payment validators
const paymentValidators = {
  create: [
    body("type")
      .notEmpty()
      .withMessage("Payment type is required")
      .isIn(["sadad", "cash"])
      .withMessage("Invalid payment type"),

    body("sadad_number")
      .if(body("type").equals("sadad"))
      .notEmpty()
      .withMessage("Sadad number is required for Sadad payment"),
  ],
};

module.exports = {
  handleValidationErrors,
  commonValidators,
  userValidators,
  listingValidators,
  bookingValidators,
  paymentValidators,
};
