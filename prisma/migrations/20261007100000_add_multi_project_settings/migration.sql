-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "archivedBy" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "defaultProjectId" TEXT;

-- CreateIndex
CREATE INDEX "projects_archivedAt_idx" ON "projects"("archivedAt");

-- CreateIndex
CREATE INDEX "users_defaultProjectId_idx" ON "users"("defaultProjectId");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_defaultProjectId_fkey" FOREIGN KEY ("defaultProjectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
