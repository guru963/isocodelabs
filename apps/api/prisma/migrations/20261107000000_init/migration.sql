-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('MERCHANDISER', 'SUPERVISOR');

-- CreateEnum
CREATE TYPE "UnitType" AS ENUM ('OWN', 'SUBCONTRACT');

-- CreateEnum
CREATE TYPE "Stage" AS ENUM ('CUTTING', 'PRINTING', 'WASHING', 'STITCHING', 'FINISHING', 'INSPECTION', 'EX_FACTORY');

-- CreateEnum
CREATE TYPE "IssueCategory" AS ENUM ('POWER_CUT', 'MACHINE_BREAKDOWN', 'WORKER_ABSENCE', 'FABRIC_DELAY', 'SUBCONTRACTOR_DELAY', 'QUALITY_REWORK', 'TRIMS_SHORTAGE', 'OTHER');

-- CreateEnum
CREATE TYPE "AiStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "IssueStatus" AS ENUM ('PENDING', 'CONFIRMED', 'DISMISSED');

-- CreateTable
CREATE TABLE "Unit" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "UnitType" NOT NULL,

    CONSTRAINT "Unit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'en',
    "unitId" TEXT,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Buyer" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "country" TEXT NOT NULL,

    CONSTRAINT "Buyer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BuyerLink" (
    "id" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BuyerLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TnaTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "TnaTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TnaTemplateStep" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "stage" "Stage" NOT NULL,
    "sequence" INTEGER NOT NULL,
    "daysBeforeExFactory" INTEGER NOT NULL,

    CONSTRAINT "TnaTemplateStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" TEXT NOT NULL,
    "poNumber" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "style" TEXT NOT NULL,
    "colour" TEXT NOT NULL,
    "totalQty" INTEGER NOT NULL,
    "exFactoryDate" DATE NOT NULL,
    "unitId" TEXT NOT NULL,
    "merchandiserId" TEXT NOT NULL,
    "templateId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderSize" (
    "orderId" TEXT NOT NULL,
    "size" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,

    CONSTRAINT "OrderSize_pkey" PRIMARY KEY ("orderId","size")
);

-- CreateTable
CREATE TABLE "Milestone" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "stage" "Stage" NOT NULL,
    "sequence" INTEGER NOT NULL,
    "plannedDate" DATE NOT NULL,
    "unitId" TEXT NOT NULL,
    "plannedQty" INTEGER,
    "doneQty" INTEGER NOT NULL DEFAULT 0,
    "completedAt" DATE,

    CONSTRAINT "Milestone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyUpdate" (
    "id" UUID NOT NULL,
    "milestoneId" TEXT NOT NULL,
    "supervisorId" TEXT NOT NULL,
    "workDate" DATE NOT NULL,
    "qty" INTEGER NOT NULL,
    "photoUrl" TEXT,
    "noteText" TEXT,
    "voiceUrl" TEXT,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supersededAt" TIMESTAMP(3),

    CONSTRAINT "DailyUpdate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Issue" (
    "id" TEXT NOT NULL,
    "dailyUpdateId" UUID NOT NULL,
    "originalText" TEXT NOT NULL,
    "translatedText" TEXT,
    "aiStatus" "AiStatus" NOT NULL DEFAULT 'PENDING',
    "aiCategory" "IssueCategory",
    "aiConfidence" DOUBLE PRECISION,
    "finalCategory" "IssueCategory",
    "status" "IssueStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Issue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT,
    "reason" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Holiday" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "unitId" TEXT,

    CONSTRAINT "Holiday_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Unit_name_key" ON "Unit"("name");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Buyer_name_key" ON "Buyer"("name");

-- CreateIndex
CREATE UNIQUE INDEX "BuyerLink_tokenHash_key" ON "BuyerLink"("tokenHash");

-- CreateIndex
CREATE INDEX "BuyerLink_buyerId_idx" ON "BuyerLink"("buyerId");

-- CreateIndex
CREATE UNIQUE INDEX "TnaTemplate_name_key" ON "TnaTemplate"("name");

-- CreateIndex
CREATE UNIQUE INDEX "TnaTemplateStep_templateId_sequence_key" ON "TnaTemplateStep"("templateId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "TnaTemplateStep_templateId_stage_key" ON "TnaTemplateStep"("templateId", "stage");

-- CreateIndex
CREATE UNIQUE INDEX "orders_poNumber_key" ON "orders"("poNumber");

-- CreateIndex
CREATE INDEX "orders_buyerId_idx" ON "orders"("buyerId");

-- CreateIndex
CREATE INDEX "orders_unitId_idx" ON "orders"("unitId");

-- CreateIndex
CREATE INDEX "orders_exFactoryDate_idx" ON "orders"("exFactoryDate");

-- CreateIndex
CREATE INDEX "Milestone_unitId_idx" ON "Milestone"("unitId");

-- CreateIndex
CREATE UNIQUE INDEX "Milestone_orderId_stage_key" ON "Milestone"("orderId", "stage");

-- CreateIndex
CREATE UNIQUE INDEX "Milestone_orderId_sequence_key" ON "Milestone"("orderId", "sequence");

-- CreateIndex
CREATE INDEX "DailyUpdate_milestoneId_workDate_idx" ON "DailyUpdate"("milestoneId", "workDate");

-- CreateIndex
CREATE UNIQUE INDEX "Issue_dailyUpdateId_key" ON "Issue"("dailyUpdateId");

-- CreateIndex
CREATE INDEX "Issue_status_idx" ON "Issue"("status");

-- CreateIndex
CREATE INDEX "AuditLog_entity_entityId_idx" ON "AuditLog"("entity", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "Holiday_date_unitId_key" ON "Holiday"("date", "unitId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuyerLink" ADD CONSTRAINT "BuyerLink_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "Buyer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TnaTemplateStep" ADD CONSTRAINT "TnaTemplateStep_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "TnaTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "Buyer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_merchandiserId_fkey" FOREIGN KEY ("merchandiserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "TnaTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderSize" ADD CONSTRAINT "OrderSize_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Milestone" ADD CONSTRAINT "Milestone_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Milestone" ADD CONSTRAINT "Milestone_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyUpdate" ADD CONSTRAINT "DailyUpdate_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "Milestone"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyUpdate" ADD CONSTRAINT "DailyUpdate_supervisorId_fkey" FOREIGN KEY ("supervisorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Issue" ADD CONSTRAINT "Issue_dailyUpdateId_fkey" FOREIGN KEY ("dailyUpdateId") REFERENCES "DailyUpdate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Issue" ADD CONSTRAINT "Issue_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Holiday" ADD CONSTRAINT "Holiday_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Rules Prisma's schema language cannot express.

-- A stage can never hold more pieces than planned, even with concurrent offline syncs.
ALTER TABLE "Milestone" ADD CONSTRAINT "milestone_done_qty_in_range"
  CHECK ("doneQty" >= 0 AND "doneQty" <= COALESCE("plannedQty", 0));

ALTER TABLE "DailyUpdate" ADD CONSTRAINT "daily_update_qty_not_negative" CHECK ("qty" >= 0);

-- One current figure per supervisor, stage and day. Corrections supersede the old row.
CREATE UNIQUE INDEX "daily_update_current_key"
  ON "DailyUpdate" ("milestoneId", "workDate", "supervisorId")
  WHERE "supersededAt" IS NULL;
