-- Lets the AI step retry in the background and record why it gave up.
ALTER TABLE "Issue" ADD COLUMN "aiAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Issue" ADD COLUMN "aiError" TEXT;
