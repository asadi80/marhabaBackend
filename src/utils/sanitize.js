
/**
 * Escapes HTML special characters.
 * Use when rendering untrusted text into HTML,
 * NOT when storing URLs or database values.
 */
function escapeHtml(str) {
  if (typeof str !== "string") return str;

  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

/**
 * Removes control characters.
 */
function stripControlChars(str) {
  if (typeof str !== "string") return str;

  // eslint-disable-next-line no-control-regex
  return str.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
}

/**
 * Recursively sanitizes strings.
 */
function sanitizeValue(value, opts = { html: false }) {
  if (value == null) return value;

  if (typeof value === "string") {
    let out = stripControlChars(value).trim();

    if (opts.html) {
      out = escapeHtml(out);
    }

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
 * Sanitizes request body.
 * HTML escaping is disabled by default.
 */
function sanitizeBody(body, opts = { html: false }) {
  if (!body || typeof body !== "object") return body;

  return sanitizeValue(body, opts);
}

module.exports = {
  escapeHtml,
  stripControlChars,
  sanitizeValue,
  sanitizeBody,
};
