
// src/routes/uploadRoutes.js

const express = require("express");
const upload = require("../middleware/upload");
const { prisma } = require("../config/database");
const { protect } = require("../middleware/auth");

const router = express.Router();

// Allowed upload types
const allowedTypes = ["listings", "ids", "payments"];

/**
 * POST /api/v1/uploads/:type
 *
 * Supported:
 *   /uploads/ids
 *   /uploads/payments
 *   /uploads/listings
 *
 * Multipart field:
 *   image
 */
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

      const {
        user_id,
        payment_id,

        // ID document fields
        document_type,
        side,
      } = req.body;

      const baseUrl = `${req.protocol}://${req.get("host")}`;
      const url = `${baseUrl}/uploads/${type}/${req.file.filename}`;

      // ============================================================
      // HANDLE ID DOCUMENT UPLOAD
      // ============================================================
      if (type === "ids") {
        let targetUserId = req.user.id;

        // Admin can upload ID for another user
        if (user_id) {
          targetUserId = user_id;

          const isAdmin = ["admin", "super_admin"].includes(req.user.role);
          const isOwnId = req.user.id === user_id;

          if (!isAdmin && !isOwnId) {
            return res.status(403).json({
              success: false,
              message:
                "You don't have permission to upload ID for this user",
            });
          }
        }

        // Default values
        const finalDocumentType = document_type || "national_id";
        const finalSide = side || "front";

        // Validate document type
        const allowedDocumentTypes = [
          "national_id",
          "passport",
          "driving_license",
          "other",
        ];

        if (!allowedDocumentTypes.includes(finalDocumentType)) {
          return res.status(400).json({
            success: false,
            message: "Invalid document type",
            allowedDocumentTypes,
          });
        }

        // Validate side
        const allowedSides = ["front", "back"];

        if (!allowedSides.includes(finalSide)) {
          return res.status(400).json({
            success: false,
            message: "Invalid document side",
            allowedSides,
          });
        }

        console.log("👤 Uploading ID document for user:", targetUserId);
        console.log("📄 Document type:", finalDocumentType);
        console.log("📄 Side:", finalSide);
        console.log("📎 ID URL:", url);

        // Verify user exists
        const currentUser = await prisma.user.findUnique({
          where: {
            id: targetUserId,
          },
          select: {
            id: true,
            name: true,
            email: true,
          },
        });

        if (!currentUser) {
          return res.status(404).json({
            success: false,
            message: "User not found",
          });
        }

        // ------------------------------------------------------------
        // Create UserIdDocument record
        // ------------------------------------------------------------
        const idDocument = await prisma.userIdDocument.create({
          data: {
            user_id: targetUserId,

            document_type: finalDocumentType,
            side: finalSide,

            file_url: url,
            file_name: req.file.originalname,
            file_type: req.file.mimetype,

            status: "pending",

            rejection_reason: null,
            admin_notes: null,

            reviewed_at: null,
            reviewed_by: null,
          },
        });

        console.log(
          "✅ ID document created:",
          idDocument.id
        );

        return res.status(201).json({
          success: true,
          message: "ID document uploaded successfully",

          file: {
            id: idDocument.id,
            filename: req.file.filename,
            originalName: req.file.originalname,
            size: req.file.size,
            mimetype: req.file.mimetype,
            type,
            url,
          },

          document: idDocument,
        });
      }

      // ============================================================
      // HANDLE PAYMENT RECEIPTS
      // ============================================================
      if (type === "payments") {
        // ------------------------------------------------------------
        // Existing payment
        // ------------------------------------------------------------
        if (payment_id) {
          console.log(
            "💰 Adding receipt to payment:",
            payment_id
          );

          // Verify payment exists
          const payment =
            await prisma.hostSubscriptionPayment.findUnique({
              where: {
                id: payment_id,
              },
              select: {
                host_id: true,
              },
            });

          if (!payment) {
            return res.status(404).json({
              success: false,
              message: "Payment record not found",
            });
          }

          const isAdmin = ["admin", "super_admin"].includes(
            req.user.role
          );

          const isOwnPayment =
            req.user.id === payment.host_id;

          if (!isAdmin && !isOwnPayment) {
            return res.status(403).json({
              success: false,
              message:
                "You don't have permission to upload receipt for this payment",
            });
          }

          // Update payment with receipt
          const updatedPayment =
            await prisma.hostSubscriptionPayment.update({
              where: {
                id: payment_id,
              },

              data: {
                receipt_images: {
                  push: url,
                },

                // Reset payment to pending for review
                status: "pending",

                updated_at: new Date(),
              },

              include: {
                host: {
                  select: {
                    id: true,
                    name: true,
                    email: true,
                  },
                },
              },
            });

          console.log(
            "✅ Payment receipt added:",
            updatedPayment.id
          );

          return res.status(201).json({
            success: true,
            message:
              "Payment receipt uploaded successfully",

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

        // ------------------------------------------------------------
        // Create new payment
        // ------------------------------------------------------------
        if (user_id) {
          const targetUserId = user_id;

          const isAdmin = ["admin", "super_admin"].includes(
            req.user.role
          );

          const isOwnPayment =
            req.user.id === user_id;

          if (!isAdmin && !isOwnPayment) {
            return res.status(403).json({
              success: false,
              message:
                "You don't have permission to upload payment for this user",
            });
          }

          console.log(
            "💰 Creating new payment receipt for user:",
            targetUserId
          );

          console.log(
            "📎 Payment receipt URL:",
            url
          );

          // Verify user exists
          const currentUser =
            await prisma.user.findUnique({
              where: {
                id: targetUserId,
              },
              select: {
                id: true,
                name: true,
                email: true,
              },
            });

          if (!currentUser) {
            return res.status(404).json({
              success: false,
              message: "User not found",
            });
          }

          // Create payment record
          const newPayment =
            await prisma.hostSubscriptionPayment.create({
              data: {
                host_id: targetUserId,

                amount: 0,

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
                  },
                },
              },
            });

          console.log(
            "✅ New payment record created:",
            newPayment.id
          );

          return res.status(201).json({
            success: true,
            message:
              "Payment receipt uploaded successfully",

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

        return res.status(400).json({
          success: false,
          message:
            "Either payment_id or user_id is required for payment upload",
        });
      }

      // ============================================================
      // OTHER UPLOAD TYPES
      // ============================================================
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
      console.error("❌ Upload error:", error);

      return res.status(500).json({
        success: false,
        message: "File upload failed",

        error:
          process.env.NODE_ENV === "development"
            ? error.message
            : undefined,
      });
    }
  }
);

// ================================================================
// GET VERIFICATION STATUS
// ================================================================

router.get(
  "/verification-status",
  protect,
  async (req, res) => {
    try {
      const userId = req.user.id;

      const user = await prisma.user.findUnique({
        where: {
          id: userId,
        },

        include: {
          // Get all ID documents
          user_id_documents: {
            orderBy: {
              created_at: "desc",
            },
          },

          // Get latest payment
          host_subscription_payments: {
            orderBy: {
              created_at: "desc",
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

      // ------------------------------------------------------------
      // Get ID documents
      // ------------------------------------------------------------
      const idDocuments = user.user_id_documents || [];

      const latestIdDocument =
        idDocuments.length > 0
          ? idDocuments[0]
          : null;

      // ------------------------------------------------------------
      // Get latest payment
      // ------------------------------------------------------------
      const latestPayment =
        user.host_subscription_payments?.[0] || null;

      // ------------------------------------------------------------
      // Non-host
      // ------------------------------------------------------------
      if (user.role !== "host") {
        return res.status(200).json({
          success: true,

          data: {
            id: {
              uploaded: idDocuments.length > 0,

              status: latestIdDocument
                ? latestIdDocument.status
                : "pending",

              documents: idDocuments,

              verified:
                latestIdDocument?.status === "approved",

              verified_at:
                latestIdDocument?.reviewed_at || null,

              rejected:
                latestIdDocument?.status === "rejected",

              rejection_reason:
                latestIdDocument?.rejection_reason || null,
            },

            payment: {
              uploaded:
                !!(
                  latestPayment &&
                  latestPayment.receipt_images &&
                  latestPayment.receipt_images.length > 0
                ),

              status:
                latestPayment?.status || "pending",

              amount:
                latestPayment?.amount || null,

              submitted_at:
                latestPayment?.created_at || null,

              approved_at: null,

              rejected:
                latestPayment?.status === "rejected",

              rejection_reason: null,
            },

            overall_status: user.status,
          },
        });
      }

      // ------------------------------------------------------------
      // Host verification status
      // ------------------------------------------------------------

      const verificationStatus = {
        id: {
          uploaded: idDocuments.length > 0,

          status:
            latestIdDocument?.status || "pending",

          documents: idDocuments,

          verified:
            latestIdDocument?.status === "approved",

          verified_at:
            latestIdDocument?.status === "approved"
              ? latestIdDocument.reviewed_at
              : null,

          rejected:
            latestIdDocument?.status === "rejected",

          rejection_reason:
            latestIdDocument?.rejection_reason || null,
        },

        payment: {
          uploaded:
            !!(
              latestPayment &&
              latestPayment.receipt_images &&
              latestPayment.receipt_images.length > 0
            ),

          status:
            latestPayment?.status || "pending",

          amount:
            latestPayment?.amount || null,

          submitted_at:
            latestPayment?.created_at || null,

          approved_at: null,

          rejected:
            latestPayment?.status === "rejected",

          rejection_reason: null,
        },

        overall_status: user.status,
      };

      return res.status(200).json({
        success: true,
        data: verificationStatus,
      });
    } catch (error) {
      console.error(
        "❌ Error fetching verification status:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Failed to fetch verification status",
      });
    }
  }
);

module.exports = router;

