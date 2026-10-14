ALTER TABLE "BillingOrder" ADD COLUMN "razorpaySubscriptionId" TEXT;
ALTER TABLE "Subscription" ADD COLUMN "razorpaySubscriptionId" TEXT;
CREATE UNIQUE INDEX "Subscription_razorpaySubscriptionId_key" ON "Subscription"("razorpaySubscriptionId");
