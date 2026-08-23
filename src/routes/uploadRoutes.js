const express = require("express");
const path = require("path");
const upload = require("../middleware/upload");

const router = express.Router();

// Upload one image
router.post("/:type", upload.single("image"), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "No image uploaded",
      });
    }

    const type = req.params.type;

    const baseUrl = `${req.protocol}://${req.get("host")}`;

    const url = `${baseUrl}/uploads/${type}/${req.file.filename}`;

    return res.status(201).json({
      success: true,
      message: "Image uploaded successfully",
      file: {
        filename: req.file.filename,
        originalName: req.file.originalname,
        size: req.file.size,
        mimetype: req.file.mimetype,
        url,
      },
    });
  } catch (error) {
    console.error("Upload error:", error);

    return res.status(500).json({
      success: false,
      message: "Image upload failed",
    });
  }
});

module.exports = router;
