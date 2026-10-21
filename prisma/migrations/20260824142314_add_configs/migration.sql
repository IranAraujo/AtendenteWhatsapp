-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "billingConfig" JSONB,
ADD COLUMN     "bookingRules" JSONB,
ADD COLUMN     "remindersConfig" JSONB;
