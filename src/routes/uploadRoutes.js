// src/routes/uploadRoutes.js

const express = require("express");
const upload = require("../middleware/upload");
const { prisma } = require("../config/database");
const { protect } = require("../middleware/auth");

const router = express.Router();

// ================================================================
// ALLOWED UPLOAD TYPES
// ================================================================

const allowedTypes = ["listings", "ids", "payments"];

// ================================================================
// ALLOWED LISTING IMAGE TYPES
// ================================================================

const allowedListingImageTypes = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
];

const MAX_LISTING_IMAGES = 6;

// ================================================================
// POST /api/v1/uploads/:type
//
// Supported:
//
// POST /api/v1/uploads/ids
// POST /api/v1/uploads/payments
// POST /api/v1/uploads/listings
//
// Multipart field:
// image
//
// For listing uploads you can optionally send:
//
// listing_id
//
// If listing_id is provided, the image URL will automatically
// be appended to Listing.images.
// ================================================================

router.post(
  "/:type",
  protect,

  // ================================================================
  // VALIDATE UPLOAD TYPE
  // ================================================================

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
      // ============================================================
      // CHECK FILE
      // ============================================================

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
        listing_id,

        // ID document fields
        document_type,
        side,
      } = req.body;

      // ============================================================
      // BUILD FILE URL
      // ============================================================

      const baseUrl = `${req.protocol}://${req.get("host")}`;

      const url = `${baseUrl}/uploads/${type}/${req.file.filename}`;

      console.log("==============================================");
      console.log("📤 FILE UPLOAD");
      console.log("==============================================");
      console.log("Type:", type);
      console.log("Original name:", req.file.originalname);
      console.log("Filename:", req.file.filename);
      console.log("Mimetype:", req.file.mimetype);
      console.log("Size:", req.file.size);
      console.log("URL:", url);
      console.log("User:", req.user.id);
      console.log("==============================================");

      // ============================================================
      // HANDLE LISTING IMAGE UPLOAD
      // ============================================================

      if (type === "listings") {
        // ------------------------------------------------------------
        // Validate image type
        // ------------------------------------------------------------

        if (!allowedListingImageTypes.includes(req.file.mimetype)) {
          return res.status(400).json({
            success: false,
            message:
              "Invalid listing image type. Allowed: JPG, JPEG, PNG, WEBP, HEIC, HEIF",
            allowedTypes: allowedListingImageTypes,
          });
        }

        // ------------------------------------------------------------
        // If listing_id was supplied, attach image directly
        // to Listing.images
        // ------------------------------------------------------------

        if (listing_id) {
          console.log(
            "🏠 Adding uploaded image to listing:",
            listing_id
          );

          // ----------------------------------------------------------
          // Find listing
          // ----------------------------------------------------------

          const listing = await prisma.listing.findUnique({
            where: {
              id: listing_id,
            },

            select: {
              id: true,
              host_id: true,
              images: true,
              title: true,
            },
          });

          if (!listing) {
            return res.status(404).json({
              success: false,
              message: "Listing not found",
            });
          }

          // ----------------------------------------------------------
          // Only listing owner or admin can upload
          // ----------------------------------------------------------

          const isAdmin = ["admin", "super_admin"].includes(
            req.user.role
          );

          const isOwner = listing.host_id === req.user.id;

          if (!isAdmin && !isOwner) {
            return res.status(403).json({
              success: false,
              message:
                "You don't have permission to upload images to this listing",
            });
          }

          // ----------------------------------------------------------
          // Existing images
          // ----------------------------------------------------------

          const existingImages = Array.isArray(listing.images)
            ? listing.images
            : [];

          // ----------------------------------------------------------
          // Maximum 6 images
          // ----------------------------------------------------------

          if (existingImages.length >= MAX_LISTING_IMAGES) {
            return res.status(400).json({
              success: false,
              message: `A listing can have a maximum of ${MAX_LISTING_IMAGES} images`,
              images: existingImages,
            });
          }

          // ----------------------------------------------------------
          // Add image URL
          // ----------------------------------------------------------

          const updatedImages = [
            ...existingImages,
            url,
          ];

          // ----------------------------------------------------------
          // Update Listing.images
          // ----------------------------------------------------------

          const updatedListing = await prisma.listing.update({
            where: {
              id: listing_id,
            },

            data: {
              images: updatedImages,
            },

            select: {
              id: true,
              title: true,
              images: true,
              updated_at: true,
            },
          });

          console.log(
            "✅ Listing image saved:",
            listing_id
          );

          console.log(
            "🖼️ Total images:",
            updatedImages.length
          );

          return res.status(201).json({
            success: true,
            message: "Listing image uploaded successfully",

            file: {
              filename: req.file.filename,
              originalName: req.file.originalname,
              size: req.file.size,
              mimetype: req.file.mimetype,
              type,
              url,
            },

            listing: updatedListing,
          });
        }

        // ------------------------------------------------------------
        // No listing_id
        //
        // This is useful when creating a NEW listing.
        //
        // The frontend uploads the image first, receives the URL,
        // and then sends the URLs when creating the Listing.
        // ------------------------------------------------------------

        console.log(
          "✅ Listing image uploaded without listing_id"
        );

        return res.status(201).json({
          success: true,
          message: "Listing image uploaded successfully",

          file: {
            filename: req.file.filename,
            originalName: req.file.originalname,
            size: req.file.size,
            mimetype: req.file.mimetype,
            type,
            url,
          },

          url,
          imageUrl: url,
        });
      }

      // ============================================================
      // HANDLE ID DOCUMENT UPLOAD
      // ============================================================

      if (type === "ids") {
        let targetUserId = req.user.id;

        // ------------------------------------------------------------
        // Admin can upload ID for another user
        // ------------------------------------------------------------

        if (user_id) {
          targetUserId = user_id;

          const isAdmin = [
            "admin",
            "super_admin",
          ].includes(req.user.role);

          const isOwnId = req.user.id === user_id;

          if (!isAdmin && !isOwnId) {
            return res.status(403).json({
              success: false,
              message:
                "You don't have permission to upload ID for this user",
            });
          }
        }

        // ------------------------------------------------------------
        // Default values
        // ------------------------------------------------------------

        const finalDocumentType =
          document_type || "national_id";

        const finalSide = side || "front";

        // ------------------------------------------------------------
        // Allowed document types
        // ------------------------------------------------------------

        const allowedDocumentTypes = [
          "national_id",
          "passport",
          "driving_license",
          "other",
        ];

        if (
          !allowedDocumentTypes.includes(
            finalDocumentType
          )
        ) {
          return res.status(400).json({
            success: false,
            message: "Invalid document type",
            allowedDocumentTypes,
          });
        }

        // ------------------------------------------------------------
        // Allowed sides
        // ------------------------------------------------------------

        const allowedSides = [
          "front",
          "back",
        ];

        if (!allowedSides.includes(finalSide)) {
          return res.status(400).json({
            success: false,
            message: "Invalid document side",
            allowedSides,
          });
        }

        console.log(
          "👤 Uploading ID document for user:",
          targetUserId
        );

        console.log(
          "📄 Document type:",
          finalDocumentType
        );

        console.log(
          "📄 Side:",
          finalSide
        );

        console.log(
          "📎 ID URL:",
          url
        );

        // ------------------------------------------------------------
        // Verify user exists
        // ------------------------------------------------------------

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

        // ------------------------------------------------------------
        // Create UserIdDocument
        // ------------------------------------------------------------

        const idDocument =
          await prisma.userIdDocument.create({
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
          message:
            "ID document uploaded successfully",

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
        // EXISTING PAYMENT
        // ------------------------------------------------------------

        if (payment_id) {
          console.log(
            "💰 Adding receipt to payment:",
            payment_id
          );

          // ----------------------------------------------------------
          // Verify payment exists
          // ----------------------------------------------------------

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

          // ----------------------------------------------------------
          // Permission
          // ----------------------------------------------------------

          const isAdmin = [
            "admin",
            "super_admin",
          ].includes(req.user.role);

          const isOwnPayment =
            req.user.id === payment.host_id;

          if (!isAdmin && !isOwnPayment) {
            return res.status(403).json({
              success: false,
              message:
                "You don't have permission to upload receipt for this payment",
            });
          }

          // ----------------------------------------------------------
          // Update payment
          // ----------------------------------------------------------

          const updatedPayment =
            await prisma.hostSubscriptionPayment.update({
              where: {
                id: payment_id,
              },

              data: {
                receipt_images: {
                  push: url,
                },

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
        // CREATE NEW PAYMENT
        // ------------------------------------------------------------

        if (user_id) {
          const targetUserId = user_id;

          const isAdmin = [
            "admin",
            "super_admin",
          ].includes(req.user.role);

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

          // ----------------------------------------------------------
          // Verify user
          // ----------------------------------------------------------

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

          // ----------------------------------------------------------
          // Create payment
          // ----------------------------------------------------------

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

        // ------------------------------------------------------------
        // No payment_id or user_id
        // ------------------------------------------------------------

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

        url,
        imageUrl: url,
      });
    } catch (error) {
      // ============================================================
      // ERROR
      // ============================================================

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

      // ============================================================
      // GET USER
      // ============================================================

      const user =
        await prisma.user.findUnique({
          where: {
            id: userId,
          },

          include: {
            // ------------------------------------------------------
            // All ID documents
            // ------------------------------------------------------

            user_id_documents: {
              orderBy: {
                created_at: "desc",
              },
            },

            // ------------------------------------------------------
            // Latest payment
            // ------------------------------------------------------

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

      // ============================================================
      // ID DOCUMENTS
      // ============================================================

      const idDocuments =
        user.user_id_documents || [];

      const latestIdDocument =
        idDocuments.length > 0
          ? idDocuments[0]
          : null;

      // ============================================================
      // LATEST PAYMENT
      // ============================================================

      const latestPayment =
        user.host_subscription_payments?.[0] ||
        null;

      // ============================================================
      // VERIFICATION OBJECT
      // ============================================================

      const verificationStatus = {
        id: {
          uploaded:
            idDocuments.length > 0,

          status:
            latestIdDocument?.status ||
            "pending",

          documents:
            idDocuments,

          verified:
            latestIdDocument?.status ===
            "approved",

          verified_at:
            latestIdDocument?.status ===
            "approved"
              ? latestIdDocument.reviewed_at
              : null,

          rejected:
            latestIdDocument?.status ===
            "rejected",

          rejection_reason:
            latestIdDocument?.rejection_reason ||
            null,
        },

        payment: {
          uploaded:
            !!(
              latestPayment &&
              latestPayment.receipt_images &&
              latestPayment.receipt_images.length >
                0
            ),

          status:
            latestPayment?.status ||
            "pending",

          amount:
            latestPayment?.amount ||
            null,

          submitted_at:
            latestPayment?.created_at ||
            null,

          approved_at: null,

          rejected:
            latestPayment?.status ===
            "rejected",

          rejection_reason: null,
        },

        overall_status: user.status,
      };

      // ============================================================
      // RESPONSE
      // ============================================================

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

// ================================================================
// EXPORT
// ================================================================

module.exports = router;