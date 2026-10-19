-- CreateEnum
CREATE TYPE "CustomFieldModule" AS ENUM ('PROJECT', 'PHASE', 'MILESTONE', 'TASK', 'RESOURCE', 'FUNDING_RECORD', 'LIVING_LAB');

-- CreateTable
CREATE TABLE "custom_field_definitions" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "module" "CustomFieldModule" NOT NULL,
    "name" TEXT NOT NULL,
    "fieldType" TEXT NOT NULL,
    "options" JSONB,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "defaultValue" TEXT,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "custom_field_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "custom_field_values" (
    "id" TEXT NOT NULL,
    "definitionId" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "valueString" TEXT,
    "valueNumber" DECIMAL(15,4),
    "valueDate" TIMESTAMP(3),
    "valueBoolean" BOOLEAN,
    "valueJson" JSONB,

    CONSTRAINT "custom_field_values_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "custom_field_definitions_projectId_module_idx" ON "custom_field_definitions"("projectId", "module");

-- CreateIndex
CREATE UNIQUE INDEX "custom_field_definitions_projectId_module_name_key" ON "custom_field_definitions"("projectId", "module", "name");

-- CreateIndex
CREATE INDEX "custom_field_values_definitionId_idx" ON "custom_field_values"("definitionId");

-- CreateIndex
CREATE INDEX "custom_field_values_entityId_idx" ON "custom_field_values"("entityId");

-- CreateIndex
CREATE UNIQUE INDEX "custom_field_values_definitionId_entityId_key" ON "custom_field_values"("definitionId", "entityId");

-- AddForeignKey
ALTER TABLE "custom_field_definitions" ADD CONSTRAINT "custom_field_definitions_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_field_values" ADD CONSTRAINT "custom_field_values_definitionId_fkey" FOREIGN KEY ("definitionId") REFERENCES "custom_field_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
