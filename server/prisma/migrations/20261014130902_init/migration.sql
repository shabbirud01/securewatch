-- CreateEnum
CREATE TYPE "ScanStatus" AS ENUM ('SUCCESS', 'FAILED');

-- CreateEnum
CREATE TYPE "ScanTrigger" AS ENUM ('MANUAL', 'SCHEDULED');

-- CreateEnum
CREATE TYPE "Grade" AS ENUM ('A', 'B', 'C', 'D', 'F');

-- CreateEnum
CREATE TYPE "CheckCategory" AS ENUM ('CERTIFICATE', 'PROTOCOL', 'HTTPS', 'HEADERS');

-- CreateEnum
CREATE TYPE "CheckStatus" AS ENUM ('PASS', 'WARN', 'FAIL', 'SKIPPED');

-- CreateEnum
CREATE TYPE "AlertType" AS ENUM ('CERT_EXPIRY', 'GRADE_DROP', 'SCAN_FAILED');

-- CreateTable
CREATE TABLE "Domain" (
    "id" SERIAL NOT NULL,
    "hostname" TEXT NOT NULL,
    "port" INTEGER NOT NULL DEFAULT 443,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Domain_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Scan" (
    "id" SERIAL NOT NULL,
    "domainId" INTEGER NOT NULL,
    "trigger" "ScanTrigger" NOT NULL,
    "status" "ScanStatus" NOT NULL,
    "grade" "Grade",
    "score" INTEGER,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "durationMs" INTEGER NOT NULL,
    "certSubject" TEXT,
    "certIssuer" TEXT,
    "certValidFrom" TIMESTAMP(3),
    "certValidTo" TIMESTAMP(3),
    "certFingerprint" TEXT,
    "tlsVersions" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "Scan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CheckResult" (
    "id" SERIAL NOT NULL,
    "scanId" INTEGER NOT NULL,
    "checkKey" TEXT NOT NULL,
    "category" "CheckCategory" NOT NULL,
    "status" "CheckStatus" NOT NULL,
    "deduction" INTEGER NOT NULL DEFAULT 0,
    "summary" TEXT NOT NULL,
    "details" JSONB,

    CONSTRAINT "CheckResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlertLog" (
    "id" SERIAL NOT NULL,
    "domainId" INTEGER NOT NULL,
    "scanId" INTEGER,
    "type" "AlertType" NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AlertLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Domain_hostname_port_key" ON "Domain"("hostname", "port");

-- CreateIndex
CREATE INDEX "Scan_domainId_startedAt_idx" ON "Scan"("domainId", "startedAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "CheckResult_scanId_checkKey_key" ON "CheckResult"("scanId", "checkKey");

-- CreateIndex
CREATE UNIQUE INDEX "AlertLog_domainId_dedupeKey_key" ON "AlertLog"("domainId", "dedupeKey");

-- AddForeignKey
ALTER TABLE "Scan" ADD CONSTRAINT "Scan_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "Domain"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckResult" ADD CONSTRAINT "CheckResult_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "Scan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlertLog" ADD CONSTRAINT "AlertLog_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "Domain"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlertLog" ADD CONSTRAINT "AlertLog_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "Scan"("id") ON DELETE SET NULL ON UPDATE CASCADE;
