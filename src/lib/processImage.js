// lib/processImage.js
const sharp = require("sharp");
const path = require("path");
const fs = require("fs/promises");
const { v4: uuidv4 } = require("uuid");

const UPLOAD_BASE = path.join(__dirname, "../../public/uploads");

const MAX_DIMENSION = 2048;
const JPEG_QUALITY = 90;

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

/**
 * Processes an uploaded image buffer:
 *  - Decodes HEIC/HEIF/WebP/PNG/JPEG (sharp handles all via libvips)
 *  - Auto-rotates using EXIF orientation
 *  - Resizes so the longest side ≤ MAX_DIMENSION
 *  - Writes a JPEG (or WebP if the source was WebP and smaller)
 *
 * Returns { filename, url, mimetype, size, width, height }
 */
async function processImage(buffer, originalName, type) {
  const folderPath = path.join(UPLOAD_BASE, type);
  await ensureDir(folderPath);

  const baseName = path
    .basename(originalName, path.extname(originalName))
    .replace(/[^a-z0-9-_]/gi, "_")
    .slice(0, 60);

  // Detect source format so we can preserve WebP.
  const metadata = await sharp(buffer).metadata();
  const isWebp = metadata.format === "webp";
  const ext = isWebp ? ".webp" : ".jpg";
  const mimetype = isWebp ? "image/webp" : "image/jpeg";

  const filename = `${baseName}-${uuidv4()}${ext}`;
  const filepath = path.join(folderPath, filename);

  let pipeline = sharp(buffer, { failOn: "none" })
    .rotate() // apply EXIF orientation
    .resize({
      width: MAX_DIMENSION,
      height: MAX_DIMENSION,
      fit: "inside",
      withoutEnlargement: true,
    });

  pipeline = isWebp
    ? pipeline.webp({ quality: JPEG_QUALITY })
    : pipeline.jpeg({ quality: JPEG_QUALITY, mozjpeg: true });

  const info = await pipeline.toFile(filepath);

  return {
    filename,
    filepath,
    urlPath: `/uploads/${type}/${filename}`,
    mimetype,
    size: info.size,
    width: info.width,
    height: info.height,
  };
}

module.exports = { processImage };