-- AlterTable
ALTER TABLE "users" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- CreateIndex
CREATE INDEX "funding_records_projectId_idx" ON "funding_records"("projectId");

-- CreateIndex
CREATE INDEX "living_labs_projectId_idx" ON "living_labs"("projectId");

-- CreateIndex
CREATE INDEX "milestones_projectId_idx" ON "milestones"("projectId");

-- CreateIndex
CREATE INDEX "milestones_phaseId_idx" ON "milestones"("phaseId");

-- CreateIndex
CREATE INDEX "phases_projectId_idx" ON "phases"("projectId");

-- CreateIndex
CREATE INDEX "resources_projectId_idx" ON "resources"("projectId");

-- CreateIndex
CREATE INDEX "tags_projectId_idx" ON "tags"("projectId");

-- CreateIndex
CREATE INDEX "tasks_milestoneId_idx" ON "tasks"("milestoneId");

-- CreateIndex
CREATE INDEX "tasks_projectId_idx" ON "tasks"("projectId");

-- CreateIndex
CREATE INDEX "tasks_status_idx" ON "tasks"("status");
