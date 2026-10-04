-- Add attachment fields to StaffMessage
ALTER TABLE "StaffMessage"
  ADD COLUMN IF NOT EXISTS "attachmentKey" TEXT,
  ADD COLUMN IF NOT EXISTS "attachmentName" TEXT,
  ADD COLUMN IF NOT EXISTS "attachmentSize" INTEGER,
  ADD COLUMN IF NOT EXISTS "mimeType" TEXT,
  ADD COLUMN IF NOT EXISTS "fileData" BYTEA;
