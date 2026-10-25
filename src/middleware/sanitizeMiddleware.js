// src/middleware/sanitizeMiddleware.js
const { sanitizeBody } = require("../utils/sanitize");

function sanitizeMiddleware(req, _res, next) {
  // Escape HTML in bodies (blocks stored XSS).
  // Skip for known binary/multipart payloads.
  const ct = req.headers["content-type"] || "";
  if (ct.includes("application/json") && req.body) {
    req.body = sanitizeBody(req.body, { html: true });
  }

  if (req.query && typeof req.query === "object") {
    req.query = sanitizeBody(req.query, { html: false });
  }

  if (req.params && typeof req.params === "object") {
    req.params = sanitizeBody(req.params, { html: false });
  }

  next();
}

module.exports = sanitizeMiddleware;