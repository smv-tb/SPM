-- CreateEnum
CREATE TYPE "FundingTrancheStatus" AS ENUM ('PENDING', 'RECEIVED', 'DELAYED');

-- CreateTable
CREATE TABLE "funding_tranches" (
    "id" TEXT NOT NULL,
    "fundingRecordId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "receivedDate" TIMESTAMP(3),
    "status" "FundingTrancheStatus" NOT NULL DEFAULT 'PENDING',
    "milestoneId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "funding_tranches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "funding_tranches_fundingRecordId_idx" ON "funding_tranches"("fundingRecordId");

-- CreateIndex
CREATE INDEX "funding_tranches_dueDate_idx" ON "funding_tranches"("dueDate");

-- AddForeignKey
ALTER TABLE "funding_tranches" ADD CONSTRAINT "funding_tranches_fundingRecordId_fkey" FOREIGN KEY ("fundingRecordId") REFERENCES "funding_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "funding_tranches" ADD CONSTRAINT "funding_tranches_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "milestones"("id") ON DELETE SET NULL ON UPDATE CASCADE;
