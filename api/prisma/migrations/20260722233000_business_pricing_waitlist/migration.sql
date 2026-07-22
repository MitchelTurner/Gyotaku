-- AlterEnum
ALTER TYPE "ProductType" ADD VALUE 'GICLEE_FRAMED';

-- AlterTable
ALTER TABLE "Order" ADD COLUMN "sku" TEXT;
ALTER TABLE "Order" ADD COLUMN "skuLabel" TEXT;
ALTER TABLE "Order" ADD COLUMN "productAmountCents" INTEGER;
ALTER TABLE "Order" ADD COLUMN "shippingCents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Order" ADD COLUMN "giftNote" TEXT;

-- CreateTable
CREATE TABLE "WaitlistEntry" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "sessionId" TEXT,
    "renditionId" TEXT,
    "fishLengthIn" DOUBLE PRECISION,
    "sku" TEXT,
    "productType" "ProductType" NOT NULL DEFAULT 'PLOTTED_ORIGINAL',
    "note" TEXT,
    "notifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WaitlistEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WaitlistEntry_email_idx" ON "WaitlistEntry"("email");

-- CreateIndex
CREATE INDEX "WaitlistEntry_createdAt_idx" ON "WaitlistEntry"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WaitlistEntry_email_productType_key" ON "WaitlistEntry"("email", "productType");
