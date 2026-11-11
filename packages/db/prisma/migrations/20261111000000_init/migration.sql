-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "LoadState" AS ENUM ('DISPATCHED', 'HOLD_PENDING', 'HOLD_AUTHORIZED', 'AT_FACILITY', 'DEPARTED', 'SETTLING', 'REVIEW', 'CAPTURED', 'VOIDED', 'INVOICED', 'PAID_OUT', 'DISPUTED', 'CLOSED');

-- CreateEnum
CREATE TYPE "OfferKind" AS ENUM ('WAIT_GUARANTEED', 'SLOT_SWAP_WITH_CREDIT', 'RELEASE_TONU', 'PRIORITY_SLOT_PURCHASE', 'PART_PURCHASE');

-- CreateEnum
CREATE TYPE "OfferStatus" AS ENUM ('OPEN', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'SUPERSEDED', 'SETTLED');

-- CreateEnum
CREATE TYPE "AgentKind" AS ENUM ('CARRIER', 'FACILITY', 'SHIPPER_TREASURY');

-- CreateEnum
CREATE TYPE "Verdict" AS ENUM ('ALLOWED', 'BLOCKED', 'ESCALATED');

-- CreateEnum
CREATE TYPE "PayPalOpStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "Facility" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ianaZone" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "radiusM" INTEGER NOT NULL,
    "synthetic" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Facility_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CarrierProfile" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "usdot" TEXT NOT NULL,
    "verifiedPayeeEmail" TEXT NOT NULL,
    "payeeEmailChangedAt" TIMESTAMP(3),
    "partsCapCents" INTEGER NOT NULL DEFAULT 15000,
    "synthetic" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CarrierProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContractVersion" (
    "id" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "terms" JSONB NOT NULL,
    "shipperConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "carrierConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContractVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Load" (
    "id" TEXT NOT NULL,
    "stopSeq" INTEGER NOT NULL DEFAULT 1,
    "facilityId" TEXT NOT NULL,
    "carrierId" TEXT NOT NULL,
    "contractVersionId" TEXT NOT NULL,
    "appointmentAt" TIMESTAMP(3) NOT NULL,
    "state" "LoadState" NOT NULL DEFAULT 'DISPATCHED',
    "holdCents" INTEGER,
    "orderId" TEXT,
    "authorizationId" TEXT,
    "vaultId" TEXT,
    "synthetic" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Load_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidenceEvent" (
    "id" TEXT NOT NULL,
    "loadId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "utcAt" TIMESTAMP(3) NOT NULL,
    "deviceAt" TIMESTAMP(3),
    "confidence" DOUBLE PRECISION NOT NULL,
    "citation" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvidenceEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Plan" (
    "id" TEXT NOT NULL,
    "loadId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "hash" TEXT NOT NULL,
    "body" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayPalOp" (
    "id" TEXT NOT NULL,
    "loadId" TEXT,
    "requestId" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "amountCents" INTEGER,
    "status" "PayPalOpStatus" NOT NULL DEFAULT 'PENDING',
    "paypalId" TEXT,
    "debugId" TEXT,
    "httpStatus" INTEGER,
    "response" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayPalOp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "resourceId" TEXT,
    "verified" BOOLEAN NOT NULL,
    "rawBody" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Mandate" (
    "id" TEXT NOT NULL,
    "agent" "AgentKind" NOT NULL,
    "ownerId" TEXT NOT NULL,
    "allowedActions" "OfferKind"[],
    "counterparties" TEXT[],
    "perActionCapCents" INTEGER NOT NULL,
    "dailyCapCents" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Mandate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Offer" (
    "id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "loadId" TEXT NOT NULL,
    "fromAgent" "AgentKind" NOT NULL,
    "toAgent" "AgentKind" NOT NULL,
    "kind" "OfferKind" NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "slotDoorId" TEXT,
    "slotStartAt" TIMESTAMP(3),
    "ttlMs" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "rationale" TEXT NOT NULL,
    "contractVersionId" TEXT NOT NULL,
    "planHash" TEXT NOT NULL,
    "status" "OfferStatus" NOT NULL DEFAULT 'OPEN',
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Offer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentAction" (
    "seq" SERIAL NOT NULL,
    "agent" "AgentKind" NOT NULL,
    "action" TEXT NOT NULL,
    "offerId" TEXT,
    "mandateId" TEXT,
    "verdict" "Verdict" NOT NULL,
    "reasons" TEXT[],
    "promptHash" TEXT,
    "payload" JSONB NOT NULL,
    "prevHash" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentAction_pkey" PRIMARY KEY ("seq")
);

-- CreateTable
CREATE TABLE "Receipt" (
    "id" TEXT NOT NULL,
    "loadId" TEXT NOT NULL,
    "auditHash" TEXT NOT NULL,
    "publicSlug" TEXT NOT NULL,
    "body" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Receipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReconcileMismatch" (
    "id" TEXT NOT NULL,
    "runAt" TIMESTAMP(3) NOT NULL,
    "paypalTxnId" TEXT,
    "loadId" TEXT,
    "kind" TEXT NOT NULL,
    "ledgerCents" INTEGER,
    "paypalCents" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReconcileMismatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ContractVersion_fingerprint_key" ON "ContractVersion"("fingerprint");

-- CreateIndex
CREATE INDEX "Load_facilityId_appointmentAt_idx" ON "Load"("facilityId", "appointmentAt");

-- CreateIndex
CREATE INDEX "EvidenceEvent_loadId_idx" ON "EvidenceEvent"("loadId");

-- CreateIndex
CREATE UNIQUE INDEX "Plan_loadId_version_key" ON "Plan"("loadId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "PayPalOp_requestId_key" ON "PayPalOp"("requestId");

-- CreateIndex
CREATE INDEX "PayPalOp_loadId_idx" ON "PayPalOp"("loadId");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_eventId_key" ON "WebhookEvent"("eventId");

-- CreateIndex
CREATE INDEX "WebhookEvent_resourceId_idx" ON "WebhookEvent"("resourceId");

-- CreateIndex
CREATE INDEX "Offer_loadId_status_idx" ON "Offer"("loadId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AgentAction_hash_key" ON "AgentAction"("hash");

-- CreateIndex
CREATE INDEX "AgentAction_agent_verdict_idx" ON "AgentAction"("agent", "verdict");

-- CreateIndex
CREATE UNIQUE INDEX "Receipt_auditHash_key" ON "Receipt"("auditHash");

-- CreateIndex
CREATE UNIQUE INDEX "Receipt_publicSlug_key" ON "Receipt"("publicSlug");

-- AddForeignKey
ALTER TABLE "Load" ADD CONSTRAINT "Load_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Load" ADD CONSTRAINT "Load_carrierId_fkey" FOREIGN KEY ("carrierId") REFERENCES "CarrierProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Load" ADD CONSTRAINT "Load_contractVersionId_fkey" FOREIGN KEY ("contractVersionId") REFERENCES "ContractVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceEvent" ADD CONSTRAINT "EvidenceEvent_loadId_fkey" FOREIGN KEY ("loadId") REFERENCES "Load"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Plan" ADD CONSTRAINT "Plan_loadId_fkey" FOREIGN KEY ("loadId") REFERENCES "Load"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayPalOp" ADD CONSTRAINT "PayPalOp_loadId_fkey" FOREIGN KEY ("loadId") REFERENCES "Load"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_loadId_fkey" FOREIGN KEY ("loadId") REFERENCES "Load"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentAction" ADD CONSTRAINT "AgentAction_mandateId_fkey" FOREIGN KEY ("mandateId") REFERENCES "Mandate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_loadId_fkey" FOREIGN KEY ("loadId") REFERENCES "Load"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

