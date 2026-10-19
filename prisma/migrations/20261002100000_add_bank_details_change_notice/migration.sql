-- AlterTable
ALTER TABLE "company_settings" ADD COLUMN     "bankDetailsChangedAt" TIMESTAMP(3),
ADD COLUMN     "bankDetailsChangedBy" TEXT;
