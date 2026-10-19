-- AlterTable
ALTER TABLE "funding_records" ADD COLUMN     "date" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "milestone_tags" (
    "milestoneId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    CONSTRAINT "milestone_tags_pkey" PRIMARY KEY ("milestoneId","tagId")
);

-- CreateTable
CREATE TABLE "resource_tags" (
    "resourceId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    CONSTRAINT "resource_tags_pkey" PRIMARY KEY ("resourceId","tagId")
);

-- AddForeignKey
ALTER TABLE "milestone_tags" ADD CONSTRAINT "milestone_tags_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "milestones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "milestone_tags" ADD CONSTRAINT "milestone_tags_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resource_tags" ADD CONSTRAINT "resource_tags_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "resources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resource_tags" ADD CONSTRAINT "resource_tags_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;
