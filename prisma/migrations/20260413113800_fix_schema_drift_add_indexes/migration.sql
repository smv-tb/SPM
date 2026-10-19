-- Create cost_categories table
CREATE TABLE "cost_categories" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "cost_categories_pkey" PRIMARY KEY ("id")
);

-- Enable pgcrypto for gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Migrate existing category values from tasks into cost_categories
INSERT INTO "cost_categories" ("id", "name", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, "costCategory", NOW(), NOW()
FROM (SELECT DISTINCT "costCategory" FROM "tasks" WHERE "costCategory" IS NOT NULL AND "costCategory" != '') sub;

-- Add costCategoryId to tasks
ALTER TABLE "tasks" ADD COLUMN "costCategoryId" TEXT;

UPDATE "tasks" t
SET "costCategoryId" = cc."id"
FROM "cost_categories" cc
WHERE t."costCategory" = cc."name";

-- Drop old costCategory column from tasks
ALTER TABLE "tasks" DROP COLUMN "costCategory";

ALTER TABLE "tasks" ADD CONSTRAINT "tasks_costCategoryId_fkey"
    FOREIGN KEY ("costCategoryId") REFERENCES "cost_categories"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- Migrate living_lab_costs
INSERT INTO "cost_categories" ("id", "name", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, "category", NOW(), NOW()
FROM (SELECT DISTINCT "category" FROM "living_lab_costs" WHERE "category" IS NOT NULL AND "category" != '') sub
WHERE "category" NOT IN (SELECT "name" FROM "cost_categories");

ALTER TABLE "living_lab_costs" ADD COLUMN "costCategoryId" TEXT;

UPDATE "living_lab_costs" llc
SET "costCategoryId" = cc."id"
FROM "cost_categories" cc
WHERE llc."category" = cc."name";

ALTER TABLE "living_lab_costs" DROP COLUMN "category";

ALTER TABLE "living_lab_costs" ADD CONSTRAINT "living_lab_costs_costCategoryId_fkey"
    FOREIGN KEY ("costCategoryId") REFERENCES "cost_categories"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "cost_categories_name_key" ON "cost_categories"("name");

-- Create rate_limits table
CREATE TABLE "rate_limits" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "rate_limits_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "rate_limits_key_key" ON "rate_limits"("key");

-- Add missing indexes (using Prisma naming convention with _idx suffix)
CREATE INDEX "milestones_parentId_idx" ON "milestones"("parentId");
CREATE INDEX "funding_records_section_idx" ON "funding_records"("section");
CREATE INDEX "resources_status_idx" ON "resources"("status");
CREATE INDEX "living_lab_costs_labId_idx" ON "living_lab_costs"("labId");
CREATE INDEX "tasks_costCategoryId_idx" ON "tasks"("costCategoryId");
CREATE INDEX "living_lab_costs_costCategoryId_idx" ON "living_lab_costs"("costCategoryId");