-- AlterTable
ALTER TABLE "CarrierProfile" ADD COLUMN     "payeeVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'ACTIVE';

-- AlterTable
ALTER TABLE "Load" ADD COLUMN     "captureId" TEXT,
ADD COLUMN     "disputeId" TEXT,
ADD COLUMN     "payoutBatchId" TEXT;

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "loadId" TEXT,
    "who" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Notification_loadId_idx" ON "Notification"("loadId");

