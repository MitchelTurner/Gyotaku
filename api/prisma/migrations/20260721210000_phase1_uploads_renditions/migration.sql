-- CreateEnum
CREATE TYPE "RenditionStatus" AS ENUM ('QUEUED', 'PROCESSING', 'READY', 'FAILED', 'REJECTED');

-- CreateTable
CREATE TABLE "Upload" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "s3Key" TEXT NOT NULL,
    "imageHash" TEXT NOT NULL DEFAULT '',
    "width" INTEGER NOT NULL DEFAULT 0,
    "height" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Upload_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Rendition" (
    "id" TEXT NOT NULL,
    "uploadId" TEXT NOT NULL,
    "seed" INTEGER NOT NULL,
    "styleParams" JSONB NOT NULL,
    "status" "RenditionStatus" NOT NULL DEFAULT 'QUEUED',
    "stage" TEXT,
    "matteScore" DOUBLE PRECISION,
    "svgKey" TEXT,
    "previewKey" TEXT,
    "printKey" TEXT,
    "estPlotSeconds" INTEGER,
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "styleFingerprint" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "Rendition_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Upload_sessionId_idx" ON "Upload"("sessionId");

-- CreateIndex
CREATE INDEX "Upload_imageHash_idx" ON "Upload"("imageHash");

-- CreateIndex
CREATE INDEX "Rendition_uploadId_idx" ON "Rendition"("uploadId");

-- CreateIndex
CREATE INDEX "Rendition_status_idx" ON "Rendition"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Rendition_uploadId_seed_styleFingerprint_key" ON "Rendition"("uploadId", "seed", "styleFingerprint");

-- AddForeignKey
ALTER TABLE "Rendition" ADD CONSTRAINT "Rendition_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "Upload"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
