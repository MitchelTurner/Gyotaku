-- AlterTable
ALTER TABLE "Rendition" ADD COLUMN "previewCleanKey" TEXT;
ALTER TABLE "Rendition" ADD COLUMN "paperWidthMm" DOUBLE PRECISION;
ALTER TABLE "Rendition" ADD COLUMN "paperHeightMm" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN "editionNumber" INTEGER;
ALTER TABLE "Order" ADD COLUMN "editionSize" INTEGER;

-- CreateTable
CREATE TABLE "EditionCounter" (
    "id" TEXT NOT NULL DEFAULT 'plotted_original',
    "next" INTEGER NOT NULL DEFAULT 1,
    "size" INTEGER NOT NULL DEFAULT 25,

    CONSTRAINT "EditionCounter_pkey" PRIMARY KEY ("id")
);

INSERT INTO "EditionCounter" ("id", "next", "size") VALUES ('plotted_original', 1, 25);

-- CreateIndex
CREATE UNIQUE INDEX "Order_productType_editionNumber_key" ON "Order"("productType", "editionNumber");
