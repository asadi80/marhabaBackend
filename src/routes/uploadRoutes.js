const express = require("express");
const upload = require("../middleware/upload");
const prisma = require("../../prisma/schema.prisma");

// Use YOUR existing authentication middleware here
const { protect } = require("../middleware/auth");

const router = express.Router();

const allowedTypes = [
  "listings",
  "ids",
  "payments",
];

router.post(
  "/:type",

  // Make sure req.user is available
  protect,

  (req, res, next) => {
    const { type } = req.params;

    if (!allowedTypes.includes(type)) {
      return res.status(400).json({
        success: false,
        message: "Invalid upload type",
        allowedTypes,
      });
    }

    next();
  },

  upload.single("image"),

  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: "No file uploaded",
        });
      }

      const type = req.params.type;

      const baseUrl = `${req.protocol}://${req.get("host")}`;

      const url =
        `${baseUrl}/uploads/${type}/${req.file.filename}`;

      // ─────────────────────────────────────
      // ID IMAGE
      // ─────────────────────────────────────

      if (type === "ids") {
        await prisma.user.update({
          where: {
            id: req.user.id,
          },

          data: {
            id_images: {
              push: url,
            },
          },
        });
      }

      return res.status(201).json({
        success: true,
        message: "File uploaded successfully",

        file: {
          filename: req.file.filename,
          originalName: req.file.originalname,
          size: req.file.size,
          mimetype: req.file.mimetype,
          type,
          url,
        },
      });

    } catch (error) {
      console.error("Upload error:", error);

      return res.status(500).json({
        success: false,
        message: "File upload failed",
      });
    }
  }
);

module.exports = router;