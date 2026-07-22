-- CreateEnum
CREATE TYPE "ProductType" AS ENUM ('PLOTTED_ORIGINAL', 'GICLEE');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('DRAFT', 'AWAITING_PAYMENT', 'PAID', 'PLOTTING', 'PRINTING', 'PACKED', 'SHIPPED', 'CANCELLED', 'REFUNDED');

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "renditionId" TEXT NOT NULL,
    "productType" "ProductType" NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'DRAFT',
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "fishLengthIn" DOUBLE PRECISION,
    "email" TEXT,
    "shippingName" TEXT,
    "shippingLine1" TEXT,
    "shippingLine2" TEXT,
    "shippingCity" TEXT,
    "shippingState" TEXT,
    "shippingPostal" TEXT,
    "shippingCountry" TEXT,
    "trackingNumber" TEXT,
    "stripeCheckoutSession" TEXT,
    "stripePaymentIntent" TEXT,
    "paidAt" TIMESTAMP(3),
    "fulfillmentNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Order_stripeCheckoutSession_key" ON "Order"("stripeCheckoutSession");

-- CreateIndex
CREATE INDEX "Order_sessionId_idx" ON "Order"("sessionId");

-- CreateIndex
CREATE INDEX "Order_status_idx" ON "Order"("status");

-- CreateIndex
CREATE INDEX "Order_productType_status_idx" ON "Order"("productType", "status");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_renditionId_fkey" FOREIGN KEY ("renditionId") REFERENCES "Rendition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
