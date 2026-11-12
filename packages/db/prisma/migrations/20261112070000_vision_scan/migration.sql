-- Phase 4: vision reads of gate-cam and BOL photos (additive).
CREATE TABLE "VisionScan" (
    "id" TEXT NOT NULL,
    "loadId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "imageRef" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION,
    "raw" TEXT,
    "parsed" JSONB,
    "issues" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VisionScan_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "VisionScan_loadId_kind_idx" ON "VisionScan"("loadId", "kind");
ALTER TABLE "VisionScan" ADD CONSTRAINT "VisionScan_loadId_fkey" FOREIGN KEY ("loadId") REFERENCES "Load"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
