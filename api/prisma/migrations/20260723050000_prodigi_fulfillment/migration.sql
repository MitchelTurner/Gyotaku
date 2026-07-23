-- Prodigi print-on-demand auto-fulfillment
ALTER TABLE "Order" ADD COLUMN "fulfillmentSku" TEXT;
ALTER TABLE "Order" ADD COLUMN "prodigiOrderId" TEXT;
ALTER TABLE "Order" ADD COLUMN "prodigiStatus" TEXT;

CREATE UNIQUE INDEX "Order_prodigiOrderId_key" ON "Order"("prodigiOrderId");
CREATE INDEX "Order_prodigiOrderId_idx" ON "Order"("prodigiOrderId");
