// src/utils/errors.js
class AppError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {number} [status=400]
   * @param {object} [meta]
   */
  constructor(code, message, status = 400, meta = {}) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = status;
    this.meta = meta;
  }
}

const ErrorCodes = Object.freeze({
  VALIDATION_FAILED: "VALIDATION_FAILED",
  USER_NOT_FOUND: "USER_NOT_FOUND",
  EMAIL_NOT_VERIFIED: "EMAIL_NOT_VERIFIED",
  EMAIL_ALREADY_VERIFIED: "EMAIL_ALREADY_VERIFIED",
  INVALID_CREDENTIALS: "INVALID_CREDENTIALS",
  TOKEN_INVALID: "TOKEN_INVALID",
  TOKEN_EXPIRED: "TOKEN_EXPIRED",
  ALREADY_VERIFIED: "ALREADY_VERIFIED",
  INVALID_INPUT: "INVALID_INPUT",
  FORBIDDEN: "FORBIDDEN",
  INTERNAL_ERROR: "INTERNAL_ERROR",
});

module.exports = { AppError, ErrorCodes };