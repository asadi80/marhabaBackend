//middleware/upload
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { v4: uuidv4 } = require("uuid");

// ─────────────────────────────────────────────
// Upload directories
// ─────────────────────────────────────────────

const uploadBase = path.join(__dirname, "../../public/uploads");

const folders = [
  "listings",
  "ids",
  "payments",
];

// Create folders automatically
folders.forEach((folder) => {
  const folderPath = path.join(uploadBase, folder);

  if (!fs.existsSync(folderPath)) {
    fs.mkdirSync(folderPath, {
      recursive: true,
    });
  }
});

// ─────────────────────────────────────────────
// Storage
// ─────────────────────────────────────────────

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const type = req.params.type;

    if (!folders.includes(type)) {
      return cb(new Error("Invalid upload type"));
    }

    const folderPath = path.join(uploadBase, type);

    if (!fs.existsSync(folderPath)) {
      fs.mkdirSync(folderPath, {
        recursive: true,
      });
    }

    cb(null, folderPath);
  },

  filename: (req, file, cb) => {
    const extension = path
      .extname(file.originalname)
      .toLowerCase();

    const filename = `${uuidv4()}${extension}`;

    cb(null, filename);
  },
});

// ─────────────────────────────────────────────
// Allowed MIME types
// ─────────────────────────────────────────────

const allowedMimeTypes = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/pdf",
];

// ─────────────────────────────────────────────
// Allowed extensions
// ─────────────────────────────────────────────

const allowedExtensions = [
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".heic",
  ".heif",
  ".pdf",
];

// ─────────────────────────────────────────────
// File filter
// ─────────────────────────────────────────────

const fileFilter = (req, file, cb) => {
  const extension = path
    .extname(file.originalname)
    .toLowerCase();

  // Some browsers report HEIC/HEIF as:
  // application/octet-stream
  //
  // Therefore we check BOTH MIME type
  // and file extension.

  const validMimeType =
    allowedMimeTypes.includes(file.mimetype);

  const validExtension =
    allowedExtensions.includes(extension);

  if (validMimeType || validExtension) {
    return cb(null, true);
  }

  return cb(
    new Error(
      "Only JPG, JPEG, PNG, WebP, HEIC, HEIF, and PDF files are allowed"
    )
  );
};

// ─────────────────────────────────────────────
// Multer configuration
// ─────────────────────────────────────────────

const upload = multer({
  storage,
  fileFilter,

  limits: {
    fileSize: 10 * 1024 * 1024, // 10 MB
  },
});

module.exports = upload;