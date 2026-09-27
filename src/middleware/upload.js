// middleware/upload.js
const multer = require("multer");

const allowedMimeTypes = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/pdf",
];

const allowedExtensions = [
  ".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif", ".pdf",
];

const fileFilter = (req, file, cb) => {
  const ext = (file.originalname.match(/\.[^.]+$/) || [""])[0].toLowerCase();
  const validMime = allowedMimeTypes.includes(file.mimetype);
  const validExt = allowedExtensions.includes(ext);

  // Some browsers send HEIC as application/octet-stream — accept by ext.
  if (validMime || validExt) return cb(null, true);

  return cb(
    new Error(
      "Only JPG, JPEG, PNG, WebP, HEIC, HEIF, and PDF files are allowed",
    ),
  );
};

// Use memory storage so we can re-encode with sharp before writing.
const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 },
});

module.exports = upload;