-- CreateEnum
CREATE TYPE "FundingStage" AS ENUM ('PROSPECT', 'PREPARING', 'SUBMITTED', 'IN_REVIEW', 'AWARDED', 'REJECTED', 'WITHDRAWN');

-- AlterTable
ALTER TABLE "funding_records" ADD COLUMN     "contactEmail" TEXT,
ADD COLUMN     "contactName" TEXT,
ADD COLUMN     "deadline" TIMESTAMP(3),
ADD COLUMN     "funderUrl" TEXT,
ADD COLUMN     "nextAction" TEXT,
ADD COLUMN     "nextActionDate" TIMESTAMP(3),
ADD COLUMN     "probability" INTEGER,
ADD COLUMN     "stage" "FundingStage";

-- CreateIndex
CREATE INDEX "funding_records_stage_idx" ON "funding_records"("stage");

-- CreateIndex
CREATE INDEX "funding_records_deadline_idx" ON "funding_records"("deadline");

-- CreateIndex
CREATE INDEX "tasks_resourceId_idx" ON "tasks"("resourceId");

-- Backfill: existing pipeline records need a starting stage so the Kanban
-- board has somewhere to put them. Non-pipeline records stay NULL — stage
-- only applies when section = PIPELINE.
UPDATE "funding_records" SET "stage" = 'PROSPECT' WHERE "section" = 'PIPELINE' AND "stage" IS NULL;
