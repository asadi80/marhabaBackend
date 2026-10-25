// src/validators/authValidators.js
const { AppError, ErrorCodes } = require("../utils/errors");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?[0-9\s\-()]{6,20}$/;
const URL_RE = /^https?:\/\/[^\s<>"']+$/i;

function fail(message, field) {
  throw new AppError(
    ErrorCodes.VALIDATION_FAILED,
    message,
    400,
    field ? { field } : {},
  );
}

function validateRegister(body) {
  const required = ["name", "email", "password", "phone_number"];
  const missing = required.filter((f) => !body?.[f]);

  if (missing.length) {
    throw new AppError(
      ErrorCodes.VALIDATION_FAILED,
      `Missing required fields: ${missing.join(", ")}`,
      400,
      { fields: missing },
    );
  }

  if (!EMAIL_RE.test(body.email)) fail("Invalid email address", "email");
  if (!PHONE_RE.test(body.phone_number))
    fail("Invalid phone number", "phone_number");
  if (String(body.password).length < 8)
    fail("Password must be at least 8 characters", "password");
  if (typeof body.name !== "string" || body.name.trim().length < 2)
    fail("Name must be at least 2 characters", "name");

  return {
    name: body.name,
    email: body.email.toLowerCase(),
    password: body.password,
    phone_number: body.phone_number,
  };
}

function validateLogin(body) {
  if (!body?.email || !body?.password) {
    fail("Email and password are required");
  }
  if (!EMAIL_RE.test(body.email)) fail("Invalid email address", "email");
  return { email: body.email.toLowerCase(), password: body.password };
}

function validateUpdateMe(body) {
  // ── Explicit whitelist: role, status, id, tokens are NOT updatable here.
  const allowed = ["name", "phone_number", "avatar_url", "bio", "locale"];
  const updates = {};

  for (const key of allowed) {
    if (body[key] !== undefined) updates[key] = body[key];
  }

  if (updates.name !== undefined) {
    if (typeof updates.name !== "string" || updates.name.trim().length < 2)
      fail("Name must be at least 2 characters", "name");
    updates.name = updates.name.trim();
  }

  if (updates.phone_number !== undefined && !PHONE_RE.test(updates.phone_number))
    fail("Invalid phone number", "phone_number");

  if (updates.avatar_url !== undefined) {
    if (updates.avatar_url === null) {
      // allow clearing
    } else if (
      typeof updates.avatar_url !== "string" ||
      !URL_RE.test(updates.avatar_url)
    ) {
      fail("avatar_url must be a valid http(s) URL", "avatar_url");
    }
  }

  if (updates.bio !== undefined) {
    if (typeof updates.bio !== "string" || updates.bio.length > 500)
      fail("Bio must be under 500 characters", "bio");
  }

  return updates;
}

function validateChangePassword(body) {
  if (!body?.current_password || !body?.new_password) {
    fail("Current password and new password are required");
  }
  if (String(body.new_password).length < 8)
    fail("New password must be at least 8 characters", "new_password");
  if (body.current_password === body.new_password)
    fail("New password must differ from current password", "new_password");

  return {
    current_password: body.current_password,
    new_password: body.new_password,
  };
}

function validateAddIdImage(body) {
  if (!body?.url) fail("Image URL is required", "url");
  if (typeof body.url !== "string" || !URL_RE.test(body.url)) {
    fail("url must be a valid http(s) URL", "url");
  }
  return { url: body.url };
}

function validateEmailOnly(body) {
  if (!body?.email) fail("Email is required", "email");
  if (!EMAIL_RE.test(body.email)) fail("Invalid email address", "email");
  return { email: body.email.toLowerCase() };
}

module.exports = {
  validateRegister,
  validateLogin,
  validateUpdateMe,
  validateChangePassword,
  validateAddIdImage,
  validateEmailOnly,
};