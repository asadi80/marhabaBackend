// src/middleware/sanitizeMiddleware.js

const { sanitizeBody } = require("../utils/sanitize");

function sanitizeMiddleware(req, _res, next) {
  // Sanitize JSON body without HTML-encoding its contents.
  // This preserves URLs, image paths, and normal text.
  const ct = req.headers["content-type"] || "";

  if (ct.includes("application/json") && req.body) {
    req.body = sanitizeBody(req.body, { html: false });
  }

  // Sanitize query parameters.
  if (req.query && typeof req.query === "object") {
    req.query = sanitizeBody(req.query, { html: false });
  }

  // Sanitize route parameters.
  if (req.params && typeof req.params === "object") {
    req.params = sanitizeBody(req.params, { html: false });
  }

  next();
}

module.exports = sanitizeMiddleware;
