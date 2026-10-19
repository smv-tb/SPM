-- Per-project membership (S2.7). From here on a non-admin user can open only the
-- projects they are a member of.

CREATE TABLE "project_members" (
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "addedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_members_pkey" PRIMARY KEY ("projectId","userId")
);

CREATE INDEX "project_members_userId_idx" ON "project_members"("userId");

ALTER TABLE "project_members" ADD CONSTRAINT "project_members_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_addedById_fkey"
  FOREIGN KEY ("addedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Nobody loses access on the day this ships: every existing non-admin user
-- becomes a member of every existing project, at the role they already have, so
-- their effective role is unchanged. (Admins need no row.) Narrow people down
-- afterwards in Settings → Projects → Members.
INSERT INTO "project_members" ("projectId", "userId", "role", "updatedAt")
SELECT p."id", u."id", u."role", CURRENT_TIMESTAMP
  FROM "projects" p CROSS JOIN "users" u
 WHERE u."role" <> 'ADMIN';
