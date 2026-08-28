// src/routes/uploadRoutes.js

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

        // Get current user to access host_details
        const currentUser = await prisma.user.findUnique({
          where: { id: targetUserId },
        });

        if (!currentUser) {
          return res.status(404).json({
            success: false,
            message: "User not found",
          });
        }

        // Merge existing host_details with new verification status
        const hostDetails = currentUser.host_details || {};

        const updatedUser = await prisma.user.update({
          where: { id: targetUserId },
          data: {
            id_images: {
              push: url,
            },
            // Update host_details with verification status
            host_details: {
              ...hostDetails,
              id_verified: false,
              id_verified_at: null,
              id_rejected: false,
              id_rejection_reason: null,
              // Preserve payment verification status if it exists
              payment_verified: hostDetails.payment_verified || false,
              payment_verified_at: hostDetails.payment_verified_at || null,
              payment_rejected: hostDetails.payment_rejected || false,
              payment_rejection_reason: hostDetails.payment_rejection_reason || null,
            },
          },
          select: {
            id: true,
            name: true,
            email: true,
            id_images: true,
            host_details: true,
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

          // Get current user to access host_details
          const currentUser = await prisma.user.findUnique({
            where: { id: payment.host_id },
          });

          const hostDetails = currentUser?.host_details || {};

          // Update the payment record with the receipt image
          const updatedPayment = await prisma.hostSubscriptionPayment.update({
            where: { id: payment_id },
            data: {
              receipt_images: {
                push: url,
              },
              status: "pending", // Reset to pending for review
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

          // Update user's host_details with payment verification status
          if (currentUser) {
            await prisma.user.update({
              where: { id: payment.host_id },
              data: {
                host_details: {
                  ...hostDetails,
                  payment_verified: false,
                  payment_verified_at: null,
                  payment_rejected: false,
                  payment_rejection_reason: null,
                  // Preserve ID verification status
                  id_verified: hostDetails.id_verified || false,
                  id_verified_at: hostDetails.id_verified_at || null,
                  id_rejected: hostDetails.id_rejected || false,
                  id_rejection_reason: hostDetails.id_rejection_reason || null,
                },
              },
            });
          }

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

        // If no payment_id, create a NEW payment record
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

          // Get current user to access host_details
          const currentUser = await prisma.user.findUnique({
            where: { id: targetUserId },
          });

          const hostDetails = currentUser?.host_details || {};

          // Create a new payment record
          const newPayment = await prisma.hostSubscriptionPayment.create({
            data: {
              host_id: targetUserId,
              amount: 0, // You'll need to set the actual amount
              status: "pending",
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

          // Update user's host_details with payment verification status
          if (currentUser) {
            await prisma.user.update({
              where: { id: targetUserId },
              data: {
                host_details: {
                  ...hostDetails,
                  payment_verified: false,
                  payment_verified_at: null,
                  payment_rejected: false,
                  payment_rejection_reason: null,
                  // Preserve ID verification status
                  id_verified: hostDetails.id_verified || false,
                  id_verified_at: hostDetails.id_verified_at || null,
                  id_rejected: hostDetails.id_rejected || false,
                  id_rejection_reason: hostDetails.id_rejection_reason || null,
                },
              },
            });
          }

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

// --- GET VERIFICATION STATUS ENDPOINT ---
router.get("/verification-status", protect, async (req, res) => {
  try {
    const userId = req.user.id;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        host_subscription_payments: {
          orderBy: {
            created_at: 'desc',
          },
          take: 1,
        },
      },
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // If user is not a host, return a basic response
    if (user.role !== "host") {
      return res.status(200).json({
        success: true,
        data: {
          id: {
            uploaded: false,
            verified: false,
            verified_at: null,
            rejected: false,
            rejection_reason: null,
          },
          payment: {
            uploaded: false,
            status: 'pending',
            amount: null,
            submitted_at: null,
            approved_at: null,
            rejected: false,
            rejection_reason: null,
          },
          overall_status: user.status,
        },
      });
    }

    const hostDetails = user.host_details || {};
    const latestPayment = user.host_subscription_payments[0] || null;

    const verificationStatus = {
      id: {
        uploaded: user.id_images && user.id_images.length > 0,
        verified: hostDetails.id_verified || false,
        verified_at: hostDetails.id_verified_at || null,
        rejected: hostDetails.id_rejected || false,
        rejection_reason: hostDetails.id_rejection_reason || null,
      },
      payment: {
        uploaded: latestPayment && latestPayment.receipt_images && latestPayment.receipt_images.length > 0,
        status: latestPayment ? latestPayment.status : 'pending',
        amount: latestPayment ? latestPayment.amount : null,
        submitted_at: latestPayment ? latestPayment.created_at : null,
        approved_at: hostDetails.payment_verified_at || null,
        rejected: hostDetails.payment_rejected || false,
        rejection_reason: hostDetails.payment_rejection_reason || null,
      },
      overall_status: user.status,
    };

    res.status(200).json({
      success: true,
      data: verificationStatus,
    });
  } catch (error) {
    console.error("❌ Error fetching verification status:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch verification status",
    });
  }
});

module.exports = router;