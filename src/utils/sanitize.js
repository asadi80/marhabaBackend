// src/utils/sanitize.js
/**
 * Escapes HTML special characters to prevent XSS / HTML injection.
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  if (typeof str !== "string") return str;
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;")
    .replace(/\//g, "&#x2F;")
    .replace(/`/g, "&#x60;")
    .replace(/=/g, "&#x3D;");
}

/**
 * Removes control characters (except whitespace/newlines/tabs).
 * @param {string} str
 * @returns {string}
 */
function stripControlChars(str) {
  if (typeof str !== "string") return str;
  // eslint-disable-next-line no-control-regex
  return str.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
}

/**
 * Recursively sanitizes strings inside an object.
 * Non-strings are passed through untouched.
 * @param {unknown} value
 * @param {{ html?: boolean }} [opts]
 * @returns {unknown}
 */
function sanitizeValue(value, opts = { html: false }) {
  if (value == null) return value;

  if (typeof value === "string") {
    let out = stripControlChars(value).trim();
    if (opts.html) out = escapeHtml(out);
    return out;
  }

  if (Array.isArray(value)) {
    return value.map((v) => sanitizeValue(v, opts));
  }

  if (typeof value === "object" && value.constructor === Object) {
    const out = {};
    for (const key of Object.keys(value)) {
      out[key] = sanitizeValue(value[key], opts);
    }
    return out;
  }

  return value;
}

/**
 * Sanitizes all string fields of a request body.
 * By default, escapes HTML to block stored XSS.
 * @param {Record<string, any>} body
 * @param {{ html?: boolean }} [opts]
 */
function sanitizeBody(body, opts = { html: true }) {
  if (!body || typeof body !== "object") return body;
  return sanitizeValue(body, opts);
}

module.exports = { escapeHtml, stripControlChars, sanitizeValue, sanitizeBody };