const express = require("express");
const upload = require("../middleware/upload");
const { prisma } = require("../config/database");
const { protect } = require("../middleware/auth");

const router = express.Router();

const allowedTypes = ["listings", "ids", "payments"];

router.post(
  "/:type",
  protect,

  // Validate upload type
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

  // Receive multipart/form-data field named "image"
  upload.single("image"),

  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: "No file uploaded",
        });
      }

      const { type } = req.params;
      const { user_id } = req.body; // Get user_id from request body

      // Determine which user to update
      let targetUserId = req.user.id; // Default to authenticated user

      // For ID uploads, use the provided user_id if available
      if (type === "ids" && user_id) {
        targetUserId = user_id;
        
        // OPTIONAL: Permission check
        // Only allow if admin OR the user is updating their own ID
        const isAdmin = ['admin', 'super_admin'].includes(req.user.role);
        const isOwnId = req.user.id === user_id;
        
        if (!isAdmin && !isOwnId) {
          return res.status(403).json({
            success: false,
            message: "You don't have permission to upload ID for this user",
          });
        }
      }

      // For payment receipts, also use the provided user_id
      if (type === "payments" && user_id) {
        targetUserId = user_id;
        
        // Permission check for payments
        const isAdmin = ['admin', 'super_admin'].includes(req.user.role);
        const isOwnPayment = req.user.id === user_id;
        
        if (!isAdmin && !isOwnPayment) {
          return res.status(403).json({
            success: false,
            message: "You don't have permission to upload payment for this user",
          });
        }
      }

      const baseUrl = `${req.protocol}://${req.get("host")}`;
      const url = `${baseUrl}/uploads/${type}/${req.file.filename}`;

      // Save ID image URL to the target user
      if (type === "ids") {
        console.log("👤 Authenticated user ID:", req.user.id);
        console.log("🎯 Target user ID:", targetUserId);
        console.log("🖼️ Saving ID image URL:", url);

        // First, get current user data to see if id_images exists
        const currentUser = await prisma.user.findUnique({
          where: { id: targetUserId },
          select: { id_images: true }
        });

        // Update with the new image URL
        const updatedUser = await prisma.user.update({
          where: {
            id: targetUserId,
          },
          data: {
            id_images: {
              push: url,
            },
          },
          select: {
            id: true,
            id_images: true,
          },
        });

        console.log("✅ User after ID image update:", updatedUser);
      }

      // Handle payment receipts
      if (type === "payments") {
        console.log("💰 Payment receipt uploaded for user:", targetUserId);
        console.log("📎 Payment receipt URL:", url);

        // Update payment receipt URL for the target user
        const updatedUser = await prisma.user.update({
          where: {
            id: targetUserId,
          },
          data: {
            paymentReceiptUrl: url,
          },
          select: {
            id: true,
            paymentReceiptUrl: true,
          },
        });

        console.log("✅ User after payment receipt update:", updatedUser);
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
        user: {
          id: targetUserId,
        }
      });
    } catch (error) {
      console.error("Upload error:", error);

      return res.status(500).json({
        success: false,
        message: "File upload failed",
        error: process.env.NODE_ENV === "development" ? error.message : undefined,
      });
    }
  },
);

module.exports = router;