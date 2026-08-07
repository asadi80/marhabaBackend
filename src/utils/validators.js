const { body, param, query, validationResult } = require('express-validator');

// Common validators
const validate = (validations) => {
  return async (req, res, next) => {
    await Promise.all(validations.map(validation => validation.run(req)));
    
    const errors = validationResult(req);
    if (errors.isEmpty()) {
      return next();
    }
    
    res.status(400).json({
      success: false,
      errors: errors.array().map(err => ({
        field: err.param,
        message: err.msg,
      })),
    });
  };
};

// User validation rules
const userValidation = {
  register: [
    body('name')
      .trim()
      .notEmpty().withMessage('Name is required')
      .isLength({ min: 2, max: 255 }).withMessage('Name must be between 2-255 characters'),
    
    body('email')
      .trim()
      .notEmpty().withMessage('Email is required')
      .isEmail().withMessage('Please provide a valid email')
      .normalizeEmail(),
    
    body('password')
      .notEmpty().withMessage('Password is required')
      .isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
      .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/).withMessage('Password must contain uppercase, lowercase, and number'),
    
    body('phone_number')
      .trim()
      .notEmpty().withMessage('Phone number is required')
      .matches(/^\+?[1-9]\d{1,14}$/).withMessage('Please provide a valid phone number'),
  ],
  
  login: [
    body('email')
      .trim()
      .notEmpty().withMessage('Email is required')
      .isEmail().withMessage('Please provide a valid email'),
    
    body('password')
      .notEmpty().withMessage('Password is required'),
  ],
  
  updateProfile: [
    body('name')
      .optional()
      .trim()
      .isLength({ min: 2, max: 255 }).withMessage('Name must be between 2-255 characters'),
    
    body('phone_number')
      .optional()
      .trim()
      .matches(/^\+?[1-9]\d{1,14}$/).withMessage('Please provide a valid phone number'),
  ],
};

// Listing validation rules
const listingValidation = {
  create: [
    body('title')
      .trim()
      .notEmpty().withMessage('Title is required')
      .isLength({ min: 5, max: 255 }).withMessage('Title must be between 5-255 characters'),
    
    body('description')
      .trim()
      .notEmpty().withMessage('Description is required')
      .isLength({ min: 20, max: 5000 }).withMessage('Description must be between 20-5000 characters'),
    
    body('price')
      .notEmpty().withMessage('Price is required')
      .isFloat({ min: 0 }).withMessage('Price must be a positive number'),
    
    body('location')
      .trim()
      .notEmpty().withMessage('Location is required'),
    
    body('category')
      .optional()
      .isIn(['city', 'mountain', 'beach', 'countryside']).withMessage('Invalid category'),
    
    body('amenities')
      .optional()
      .isArray().withMessage('Amenities must be an array'),
    
    body('cancellation_policy')
      .optional()
      .isIn(['flexible', 'moderate', 'strict']).withMessage('Invalid cancellation policy'),
  ],
  
  update: [
    param('id')
      .notEmpty().withMessage('Listing ID is required')
      .isUUID().withMessage('Invalid listing ID format'),
  ],
};

// Booking validation rules
const bookingValidation = {
  create: [
    param('listingId')
      .notEmpty().withMessage('Listing ID is required')
      .isUUID().withMessage('Invalid listing ID format'),
    
    body('check_in')
      .notEmpty().withMessage('Check-in date is required')
      .isISO8601().withMessage('Invalid date format')
      .custom((value) => {
        const date = new Date(value);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        return date >= today;
      }).withMessage('Check-in date must be today or future date'),
    
    body('check_out')
      .notEmpty().withMessage('Check-out date is required')
      .isISO8601().withMessage('Invalid date format')
      .custom((value, { req }) => {
        const checkOut = new Date(value);
        const checkIn = new Date(req.body.check_in);
        return checkOut > checkIn;
      }).withMessage('Check-out must be after check-in'),
    
    body('guests')
      .optional()
      .isInt({ min: 1, max: 20 }).withMessage('Guests must be between 1-20'),
  ],
};

// Payment validation rules
const paymentValidation = {
  create: [
    body('booking_id')
      .notEmpty().withMessage('Booking ID is required')
      .isUUID().withMessage('Invalid booking ID format'),
    
    body('type')
      .notEmpty().withMessage('Payment type is required')
      .isIn(['sadad', 'cash']).withMessage('Invalid payment type'),
    
    body('sadad_number')
      .if(body('type').equals('sadad'))
      .notEmpty().withMessage('Sadad number is required for Sadad payment'),
  ],
};

// ID validation
const idValidation = {
  paramId: [
    param('id')
      .notEmpty().withMessage('ID is required')
      .isUUID().withMessage('Invalid ID format'),
  ],
};

module.exports = {
  validate,
  userValidation,
  listingValidation,
  bookingValidation,
  paymentValidation,
  idValidation,
};