-- CreateTable
CREATE TABLE "step_up_verifications" (
    "sessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "step_up_verifications_pkey" PRIMARY KEY ("sessionId")
);

-- CreateIndex
CREATE INDEX "step_up_verifications_userId_idx" ON "step_up_verifications"("userId");

-- CreateIndex
CREATE INDEX "step_up_verifications_verifiedAt_idx" ON "step_up_verifications"("verifiedAt");

-- AddForeignKey
ALTER TABLE "step_up_verifications" ADD CONSTRAINT "step_up_verifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
