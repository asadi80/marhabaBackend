// In src/routes/uploadRoutes.js

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
      const { user_id, payment_id } = req.body;
      const baseUrl = `${req.protocol}://${req.get("host")}`;
      const url = `${baseUrl}/uploads/${type}/${req.file.filename}`;

      // --- HANDLE ID UPLOADS ---
      if (type === "ids") {
        let targetUserId = req.user.id;

        if (user_id) {
          targetUserId = user_id;
          const isAdmin = ['admin', 'super_admin'].includes(req.user.role);
          const isOwnId = req.user.id === user_id;
          
          if (!isAdmin && !isOwnId) {
            return res.status(403).json({
              success: false,
              message: "You don't have permission to upload ID for this user",
            });
          }
        }

        console.log("👤 Uploading ID for user:", targetUserId);
        console.log("📎 ID URL:", url);

        const updatedUser = await prisma.user.update({
          where: { id: targetUserId },
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

        return res.status(201).json({
          success: true,
          message: "ID uploaded successfully",
          file: {
            filename: req.file.filename,
            originalName: req.file.originalname,
            size: req.file.size,
            mimetype: req.file.mimetype,
            type,
            url,
          },
          user: updatedUser,
        });
      }

      // --- HANDLE PAYMENT RECEIPTS ---
      if (type === "payments") {
        // If payment_id is provided, update existing payment record
        if (payment_id) {
          console.log("💰 Adding receipt to payment:", payment_id);

          // Verify payment exists and user has permission
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
            where: { id: payment_id },
            data: {
              receipt_images: {
                push: url,
              },
              status: "uploaded",
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

        // If no payment_id, create a NEW payment record or throw error
        if (user_id) {
          const targetUserId = user_id;
          
          const isAdmin = ['admin', 'super_admin'].includes(req.user.role);
          const isOwnPayment = req.user.id === user_id;
          
          if (!isAdmin && !isOwnPayment) {
            return res.status(403).json({
              success: false,
              message: "You don't have permission to upload payment for this user",
            });
          }

          console.log("💰 Creating new payment receipt for user:", targetUserId);
          console.log("📎 Payment receipt URL:", url);

          // Create a new payment record
          const newPayment = await prisma.hostSubscriptionPayment.create({
            data: {
              host_id: targetUserId,
              amount: 0, // You'll need to set the actual amount
              status: "uploaded",
              receipt_images: [url],
              created_at: new Date(),
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

          console.log("✅ New payment record created:", newPayment.id);

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
            payment: newPayment,
          });
        }

        // No payment_id or user_id provided
        return res.status(400).json({
          success: false,
          message: "Either payment_id or user_id is required for payment upload",
        });
      }

      // Fallback for other types
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
        error: process.env.NODE_ENV === "development" ? error.message : undefined,
      });
    }
  },
);

module.exports = router;