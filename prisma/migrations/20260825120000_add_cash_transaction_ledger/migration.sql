-- CreateEnum
CREATE TYPE "CashDirection" AS ENUM ('IN', 'OUT');

-- CreateEnum
CREATE TYPE "CashSourceType" AS ENUM ('TRANCHE', 'FUNDING_RECORD', 'TASK', 'LIVING_LAB', 'MANUAL');

-- CreateTable
CREATE TABLE "cash_transactions" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "direction" "CashDirection" NOT NULL,
    "description" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'GBP',
    "costCategoryId" TEXT,
    "phaseId" TEXT,
    "milestoneId" TEXT,
    "sourceType" "CashSourceType" NOT NULL,
    "sourceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,

    CONSTRAINT "cash_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cash_transactions_projectId_date_idx" ON "cash_transactions"("projectId", "date");

-- CreateIndex
CREATE INDEX "cash_transactions_direction_date_idx" ON "cash_transactions"("direction", "date");

-- CreateIndex
CREATE INDEX "cash_transactions_costCategoryId_idx" ON "cash_transactions"("costCategoryId");

-- CreateIndex
CREATE INDEX "cash_transactions_phaseId_idx" ON "cash_transactions"("phaseId");

-- CreateIndex
CREATE UNIQUE INDEX "cash_transactions_sourceType_sourceId_key" ON "cash_transactions"("sourceType", "sourceId");

-- AddForeignKey
ALTER TABLE "cash_transactions" ADD CONSTRAINT "cash_transactions_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_transactions" ADD CONSTRAINT "cash_transactions_costCategoryId_fkey" FOREIGN KEY ("costCategoryId") REFERENCES "cost_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_transactions" ADD CONSTRAINT "cash_transactions_phaseId_fkey" FOREIGN KEY ("phaseId") REFERENCES "phases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_transactions" ADD CONSTRAINT "cash_transactions_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "milestones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_transactions" ADD CONSTRAINT "cash_transactions_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

