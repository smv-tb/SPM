-- CreateEnum
CREATE TYPE "TrancheDirection" AS ENUM ('INCOMING', 'OUTGOING');

-- AlterTable
ALTER TABLE "funding_tranches" ADD COLUMN     "direction" "TrancheDirection" NOT NULL DEFAULT 'INCOMING';
