-- Phase 3 review: one offer per (load, version).
CREATE UNIQUE INDEX "Offer_loadId_version_key" ON "Offer"("loadId", "version");
