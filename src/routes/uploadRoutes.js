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
      const { user_id, payment_id } = req.body; // Get user_id and payment_id from request body

      // Determine which user to update
      let targetUserId = req.user.id; // Default to authenticated user

      // For ID uploads, use the provided user_id if available
      if (type === "ids" && user_id) {
        targetUserId = user_id;
        
        // Permission check
        const isAdmin = ['admin', 'super_admin'].includes(req.user.role);
        const isOwnId = req.user.id === user_id;
        
        if (!isAdmin && !isOwnId) {
          return res.status(403).json({
            success: false,
            message: "You don't have permission to upload ID for this user",
          });
        }

        const baseUrl = `${req.protocol}://${req.get("host")}`;
        const url = `${baseUrl}/uploads/${type}/${req.file.filename}`;

        console.log("👤 Authenticated user ID:", req.user.id);
        console.log("🎯 Target user ID:", targetUserId);
        console.log("🖼️ Saving ID image URL:", url);

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
        // If payment_id is provided, add receipt to specific payment record
        if (payment_id) {
          console.log("💰 Payment receipt uploaded for payment ID:", payment_id);
          console.log("📎 Payment receipt URL:", url);

          const baseUrl = `${req.protocol}://${req.get("host")}`;
          const url = `${baseUrl}/uploads/${type}/${req.file.filename}`;

          // First, verify the payment belongs to the user or user has permission
          const payment = await prisma.hostSubscriptionPayment.findUnique({
            where: { id: payment_id },
            select: { host_id: true }
          });

          if (!payment) {
            return res.status(404).json({
              success: false,
              message: "Payment record not found",
            });
          }

          // Permission check
          const isAdmin = ['admin', 'super_admin'].includes(req.user.role);
          const isOwnPayment = req.user.id === payment.host_id;

          if (!isAdmin && !isOwnPayment) {
            return res.status(403).json({
              success: false,
              message: "You don't have permission to upload receipt for this payment",
            });
          }

          // Update the payment record with the receipt image
          const updatedPayment = await prisma.hostSubscriptionPayment.update({
            where: {
              id: payment_id,
            },
            data: {
              receipt_images: {
                push: url,
              },
              status: "uploaded", // Optionally update status
              updated_at: new Date(),
            },
            include: {
              host: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                }
              }
            }
          });

          console.log("✅ Payment receipt added to payment record:", updatedPayment.id);

          return res.status(201).json({
            success: true,
            message: "Payment receipt uploaded successfully",
            file: {
              filename: req.file.filename,
              originalName: req.file.originalname,
              size: req.file.size,
              mimetype: req.file.mimetype,
              type,
              url,
            },
            payment: updatedPayment,
          });
        }

        // If no payment_id, fallback to storing on user (legacy or simple case)
        if (user_id) {
          targetUserId = user_id;
          
          const isAdmin = ['admin', 'super_admin'].includes(req.user.role);
          const isOwnPayment = req.user.id === user_id;
          
          if (!isAdmin && !isOwnPayment) {
            return res.status(403).json({
              success: false,
              message: "You don't have permission to upload payment for this user",
            });
          }

          const baseUrl = `${req.protocol}://${req.get("host")}`;
          const url = `${baseUrl}/uploads/${type}/${req.file.filename}`;

          console.log("💰 Payment receipt uploaded for user:", targetUserId);
          console.log("📎 Payment receipt URL:", url);

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
        } else {
          return res.status(400).json({
            success: false,
            message: "Either payment_id or user_id is required for payment upload",
          });
        }
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