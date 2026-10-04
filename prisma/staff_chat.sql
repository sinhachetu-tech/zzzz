-- Phase: Staff internal chat (StaffRoom, StaffRoomMember, StaffMessage)
-- Safe to run multiple times: uses IF NOT EXISTS / DO NOTHING patterns.
-- Apply with: npx prisma db execute --file prisma/staff_chat.sql --schema prisma/schema.prisma

-- StaffRoom ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "StaffRoom" (
  "id"          SERIAL PRIMARY KEY,
  "name"        TEXT        NOT NULL,
  "isDirect"    BOOLEAN     NOT NULL DEFAULT false,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdById" INTEGER     NOT NULL
);

-- StaffRoomMember ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "StaffRoomMember" (
  "roomId"     INTEGER     NOT NULL,
  "userId"     INTEGER     NOT NULL,
  "joinedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastReadAt" TIMESTAMP(3),
  PRIMARY KEY ("roomId", "userId")
);

-- StaffMessage ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "StaffMessage" (
  "id"       SERIAL PRIMARY KEY,
  "roomId"   INTEGER      NOT NULL,
  "senderId" INTEGER      NOT NULL,
  "text"     TEXT,
  "sentAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "editedAt" TIMESTAMP(3)
);

-- Foreign keys ────────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'StaffRoom_createdById_fkey'
  ) THEN
    ALTER TABLE "StaffRoom"
      ADD CONSTRAINT "StaffRoom_createdById_fkey"
      FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'StaffRoomMember_roomId_fkey'
  ) THEN
    ALTER TABLE "StaffRoomMember"
      ADD CONSTRAINT "StaffRoomMember_roomId_fkey"
      FOREIGN KEY ("roomId") REFERENCES "StaffRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'StaffRoomMember_userId_fkey'
  ) THEN
    ALTER TABLE "StaffRoomMember"
      ADD CONSTRAINT "StaffRoomMember_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'StaffMessage_roomId_fkey'
  ) THEN
    ALTER TABLE "StaffMessage"
      ADD CONSTRAINT "StaffMessage_roomId_fkey"
      FOREIGN KEY ("roomId") REFERENCES "StaffRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'StaffMessage_senderId_fkey'
  ) THEN
    ALTER TABLE "StaffMessage"
      ADD CONSTRAINT "StaffMessage_senderId_fkey"
      FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- Indexes ─────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "StaffRoom_createdById_idx"    ON "StaffRoom"("createdById");
CREATE INDEX IF NOT EXISTS "StaffRoomMember_userId_idx"   ON "StaffRoomMember"("userId");
CREATE INDEX IF NOT EXISTS "StaffMessage_roomId_sentAt_idx" ON "StaffMessage"("roomId", "sentAt");
CREATE INDEX IF NOT EXISTS "StaffMessage_senderId_idx"    ON "StaffMessage"("senderId");
