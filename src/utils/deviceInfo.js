// src/utils/deviceInfo.js
const UAParser = require("ua-parser-js");

/**
 * Extracts normalized device information from an Express request.
 * Single source of truth for device parsing across controllers.
 *
 * @param {import("express").Request} req
 * @returns {{
 *   ip: string,
 *   userAgent: string,
 *   device: "desktop"|"mobile"|"tablet"|"smart-tv"|"wearable",
 *   browser: string,
 *   os: string
 * }}
 */
function getDeviceInfo(req) {
  const userAgent = req.headers["user-agent"] || "";
  const parser = new UAParser(userAgent);
  const ua = parser.getResult();

  let device = "desktop";
  switch (ua.device?.type) {
    case "mobile":
      device = "mobile";
      break;
    case "tablet":
      device = "tablet";
      break;
    case "smarttv":
      device = "smart-tv";
      break;
    case "wearable":
      device = "wearable";
      break;
    default:
      device = "desktop";
  }

  const browser = ua.browser?.name
    ? `${ua.browser.name}${ua.browser.version ? ` ${ua.browser.version}` : ""}`
    : "unknown";

  const os = ua.os?.name
    ? `${ua.os.name}${ua.os.version ? ` ${ua.os.version}` : ""}`
    : "unknown";

  // Resolve client IP behind proxies (trust proxy must be enabled in app.js)
  const forwardedFor = req.headers["x-forwarded-for"];
  const forwardedIp =
    typeof forwardedFor === "string" ? forwardedFor.split(",")[0].trim() : null;

  const ip =
    forwardedIp ||
    req.ip ||
    req.socket?.remoteAddress ||
    "unknown";

  return {
    ip,
    userAgent: userAgent || "unknown",
    device,
    browser,
    os,
  };
}

module.exports = { getDeviceInfo };