-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "google_id" VARCHAR(255),
    "profile_image" TEXT,
    "email_verified_at" TIMESTAMP,
    "phone_number" VARCHAR(50),
    "account_type" VARCHAR(50) NOT NULL DEFAULT 'traveler',
    "role" VARCHAR(50) NOT NULL DEFAULT 'user',
    "status" VARCHAR(50) NOT NULL DEFAULT 'active',
    "status_reason" TEXT,
    "host_expiry_date" TIMESTAMP,
    "auth_version" INTEGER NOT NULL DEFAULT 0,
    "last_login_at" TIMESTAMP,
    "deleted_at" TIMESTAMP,
    "last_active" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "host_details" JSONB NOT NULL DEFAULT '{"rating":0,"totalListings":0,"verified":false,"id_verified":false,"id_verified_at":null,"id_rejected":false,"id_rejection_reason":null,"payment_verified":false,"payment_verified_at":null,"payment_rejected":false,"payment_rejection_reason":null,"notificationSent":{"oneWeek":false,"twoDays":false}}',
    "user_details" JSONB NOT NULL DEFAULT '{"preferences":{},"bookings":[]}',

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserIdDocument" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "document_type" VARCHAR(50) NOT NULL DEFAULT 'national_id',
    "side" VARCHAR(20) NOT NULL DEFAULT 'front',
    "file_url" TEXT NOT NULL,
    "file_name" VARCHAR(255),
    "file_type" VARCHAR(100),
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "rejection_reason" TEXT,
    "admin_notes" TEXT,
    "reviewed_at" TIMESTAMP,
    "reviewed_by" UUID,
    "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserIdDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserSession" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "device" VARCHAR(255),
    "browser" VARCHAR(255),
    "os" VARCHAR(255),
    "ip_address" TEXT,
    "user_agent" TEXT,
    "logged_in_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "logged_out_at" TIMESTAMP,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "refresh_token_hash" TEXT,
    "expires_at" TIMESTAMP,

    CONSTRAINT "UserSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserEvent" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "event_type" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Listing" (
    "id" UUID NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "timezone" VARCHAR(100) NOT NULL DEFAULT 'Africa/Tripoli',
    "description" TEXT NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,
    "location" VARCHAR(255) NOT NULL,
    "latitude" DECIMAL(10,8),
    "longitude" DECIMAL(11,8),
    "images" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "category" VARCHAR(50) NOT NULL DEFAULT 'city',
    "amenities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "host_id" UUID NOT NULL,
    "rules" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "cancellation_policy" JSONB NOT NULL DEFAULT '{"type":"flexible","description":"","rules":[]}',
    "status" VARCHAR(20) NOT NULL DEFAULT 'active',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMP,
    "blocked_dates" JSONB NOT NULL DEFAULT '[]',
    "view_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Listing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Booking" (
    "id" UUID NOT NULL,
    "listing_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "check_in" TIMESTAMP NOT NULL,
    "check_out" TIMESTAMP NOT NULL,
    "total_price" DECIMAL(10,2) NOT NULL,
    "guests" INTEGER NOT NULL DEFAULT 1,
    "checked_in_at" TIMESTAMP,
    "checked_out_at" TIMESTAMP,
    "no_show" BOOLEAN NOT NULL DEFAULT false,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Booking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "host_blocked_users" (
    "id" UUID NOT NULL,
    "host_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "reason" VARCHAR(50) NOT NULL DEFAULT 'Blocked by host',
    "booking_id" UUID,
    "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "host_blocked_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HostSubscriptionPayment" (
    "id" UUID NOT NULL,
    "host_id" UUID NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "receipt_images" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "paid_at" TIMESTAMP,
    "period_start" TIMESTAMP,
    "period_end" TIMESTAMP,
    "reference" VARCHAR(255),
    "notes" TEXT,
    "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HostSubscriptionPayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_google_id_key" ON "User"("google_id");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE INDEX "User_account_type_idx" ON "User"("account_type");

-- CreateIndex
CREATE INDEX "User_status_idx" ON "User"("status");

-- CreateIndex
CREATE INDEX "User_deleted_at_idx" ON "User"("deleted_at");

-- CreateIndex
CREATE INDEX "User_created_at_idx" ON "User"("created_at");

-- CreateIndex
CREATE INDEX "UserIdDocument_user_id_idx" ON "UserIdDocument"("user_id");

-- CreateIndex
CREATE INDEX "UserIdDocument_status_idx" ON "UserIdDocument"("status");

-- CreateIndex
CREATE INDEX "UserIdDocument_user_id_status_idx" ON "UserIdDocument"("user_id", "status");

-- CreateIndex
CREATE INDEX "UserIdDocument_document_type_idx" ON "UserIdDocument"("document_type");

-- CreateIndex
CREATE INDEX "UserIdDocument_reviewed_by_idx" ON "UserIdDocument"("reviewed_by");

-- CreateIndex
CREATE UNIQUE INDEX "UserSession_refresh_token_hash_key" ON "UserSession"("refresh_token_hash");

-- CreateIndex
CREATE INDEX "UserSession_user_id_is_active_idx" ON "UserSession"("user_id", "is_active");

-- CreateIndex
CREATE INDEX "UserSession_expires_at_idx" ON "UserSession"("expires_at");

-- CreateIndex
CREATE INDEX "UserEvent_user_id_idx" ON "UserEvent"("user_id");

-- CreateIndex
CREATE INDEX "UserEvent_event_type_idx" ON "UserEvent"("event_type");

-- CreateIndex
CREATE INDEX "UserEvent_created_at_idx" ON "UserEvent"("created_at");

-- CreateIndex
CREATE INDEX "Listing_host_id_idx" ON "Listing"("host_id");

-- CreateIndex
CREATE INDEX "Listing_status_idx" ON "Listing"("status");

-- CreateIndex
CREATE INDEX "Listing_category_idx" ON "Listing"("category");

-- CreateIndex
CREATE INDEX "Listing_deleted_at_idx" ON "Listing"("deleted_at");

-- CreateIndex
CREATE INDEX "Listing_is_active_idx" ON "Listing"("is_active");

-- CreateIndex
CREATE INDEX "Booking_user_id_idx" ON "Booking"("user_id");

-- CreateIndex
CREATE INDEX "Booking_listing_id_check_in_check_out_idx" ON "Booking"("listing_id", "check_in", "check_out");

-- CreateIndex
CREATE INDEX "Booking_check_in_check_out_idx" ON "Booking"("check_in", "check_out");

-- CreateIndex
CREATE INDEX "Booking_status_idx" ON "Booking"("status");

-- CreateIndex
CREATE INDEX "host_blocked_users_host_id_idx" ON "host_blocked_users"("host_id");

-- CreateIndex
CREATE INDEX "host_blocked_users_user_id_idx" ON "host_blocked_users"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "host_blocked_users_host_id_user_id_key" ON "host_blocked_users"("host_id", "user_id");

-- CreateIndex
CREATE INDEX "HostSubscriptionPayment_host_id_idx" ON "HostSubscriptionPayment"("host_id");

-- CreateIndex
CREATE INDEX "HostSubscriptionPayment_host_id_status_idx" ON "HostSubscriptionPayment"("host_id", "status");

-- CreateIndex
CREATE INDEX "HostSubscriptionPayment_period_end_idx" ON "HostSubscriptionPayment"("period_end");

-- AddForeignKey
ALTER TABLE "UserIdDocument" ADD CONSTRAINT "UserIdDocument_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserIdDocument" ADD CONSTRAINT "UserIdDocument_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSession" ADD CONSTRAINT "UserSession_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserEvent" ADD CONSTRAINT "UserEvent_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_host_id_fkey" FOREIGN KEY ("host_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "Listing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "host_blocked_users" ADD CONSTRAINT "host_blocked_users_host_id_fkey" FOREIGN KEY ("host_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "host_blocked_users" ADD CONSTRAINT "host_blocked_users_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "host_blocked_users" ADD CONSTRAINT "host_blocked_users_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HostSubscriptionPayment" ADD CONSTRAINT "HostSubscriptionPayment_host_id_fkey" FOREIGN KEY ("host_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

