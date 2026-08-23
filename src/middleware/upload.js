const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { v4: uuidv4 } = require("uuid");

// Base upload directory
const uploadBase = path.join(__dirname, "../../public/uploads");

// Create folders if they don't exist
const folders = ["listings", "ids", "payments"];

folders.forEach((folder) => {
  const folderPath = path.join(uploadBase, folder);

  if (!fs.existsSync(folderPath)) {
    fs.mkdirSync(folderPath, { recursive: true });
  }
});

// Storage configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const type = req.params.type;

    if (!folders.includes(type)) {
      return cb(new Error("Invalid upload type"));
    }

    cb(null, path.join(uploadBase, type));
  },

  filename: (req, file, cb) => {
    const extension = path.extname(file.originalname).toLowerCase();

    const filename = `${uuidv4()}${extension}`;

    cb(null, filename);
  },
});

// Allowed image types
const allowedMimeTypes = [
  "image/jpeg",
  "image/png",
  "image/webp",
];

// File filter
const fileFilter = (req, file, cb) => {
  if (allowedMimeTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error("Only JPG, PNG, and WebP images are allowed"));
  }
};

// Multer configuration
const upload = multer({
  storage,
  fileFilter,

  limits: {
    fileSize: 10 * 1024 * 1024, // 10 MB
  },
});

module.exports = upload;
