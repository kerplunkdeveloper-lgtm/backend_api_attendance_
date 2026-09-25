# SaaS security and reliability fixes — 25 September 2026

This is a review branch, not a production deployment. Existing customer data and migrations were not modified. Merge/deploy after staging verification and the database checks below.

## Changes

- Employee updates validate actor and target roles. Managers cannot promote accounts or edit administrators. General employee APIs cannot grant SUPER_ADMIN or COMPANY_ADMIN.
- WebSocket connections verify active accounts and current subscription access; subscriptions and each delivery check tenant membership. Token expiry closes sessions; pong restores heartbeat liveness. Messages are limited to 4 KB and 50 subscriptions per connection.
- Direct plan upgrades return 403. Registration always creates the configured 14-day trial, even if a paid tier is selected. Paid tiers activate only from captured payments.
- Billing uses one plan configuration, validates payment order/amount/currency/state, fetches provider payment state during browser verification, and uses a PostgreSQL organization advisory lock and transaction for activation. Replays leave the expiry unchanged. Webhooks require a separate configured webhook secret.
- A canceled paid subscription retains access until its existing expiry; expired, locked, missing or invalid entitlements cannot access business modules. Auth, billing and organization settings remain accessible for recovery. There is no implicit grace period.
- Branch creation locks the organization and checks its quota. Existing employee seat checks remain; concurrency across all employee creation/reactivation paths still needs hardening.
- All root route aliases share the general limiter; independent limiter namespaces are restored from the supplied archive. Counters remain process-local.
- Candidate multipart upload validates the invitation state, restricts files to PDF/JPEG/PNG/WebP up to 10 MB, checks file signatures, uploads bytes and saves metadata. The returned invitation URL matches the frontend portal route.
- Pending overtime/correction routes pass an explicit server-enforced status filter.
- Biometric devices use shared attendance calculation/events. Registered device identity substitutes for phone/GPS checks and is recorded as a bypass reason. Inactive employees/revoked devices are rejected. Device timestamps allow at most 7 days of backlog and 5 minutes of future skew. Duplicate IN preserves the original punch. Check-in/out transactions recheck duplicates under employee locks.

## Configuration and behavior changes

1. Keep production migrations unchanged until their history is inspected. This branch adds no schema migration.
2. Configure RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET and RAZORPAY_WEBHOOK_SECRET in server secrets. Configure captured-payment delivery to `/api/billing/webhook`. Test provider delivery in test mode first.
3. Require captured payments; an authorized-but-uncaptured browser callback returns 409. The UI can retry verification after capture, or the capture webhook completes activation.
4. Review existing organization/subscription statuses and expiry dates before enabling this branch. Old test-created paid plans are not automatically converted or extended.
5. Same-plan renewals extend unused paid time. A tier change starts a new full term at its full price; proration is not implemented. Make this explicit in checkout before customer rollout.
6. Paid plan limits come from `src/config/plans.js`. ENTERPRISE follows the previously advertised 1,000 employees / 50 branches. Review existing customers on inconsistent legacy billing limits before release.
7. Existing PAID orders that failed entitlement activation under the old implementation require a reviewed reconciliation; the new replay guard does not rewrite legacy paid orders.
8. Start only one scheduler instance. WebSocket broadcasts remain local to each process; multi-replica deployment needs a shared delivery bus. Rate limiting also needs shared counters at scale.

## Validation

- 22 backend tests passed, including loopback HTTP/WebSocket regression tests, captured-payment replay and rollback simulation, upload type validation, entitlement expiry and a biometric IN/OUT flow calculating 540 working minutes / 60 overtime minutes.
- Tests use mocked persistence, file storage and payment responses. The transaction mock serializes and rolls back in memory; it does not prove PostgreSQL locking in deployment.
- Existing migration history was not applied to Neon. No real payment, email or file upload was performed.
- Pair with the frontend change branch; see its SAAS_FIXES.md for build/lint results.

Run `npm test` locally. Staging must also exercise real PostgreSQL concurrent callbacks and duplicate punches; mocked tests do not replace that gate.

## Remaining work — not claimed complete

- Neon migration repair: `0001_baseline` and `20260909071503_initial_schema` both create initial objects. Inspect `_prisma_migrations` and schema before deciding how to reconcile. Do not delete historical files, reset production, or blindly mark a migration applied.
- Loans: repayment ledger, monthly payroll deductions and outstanding balance reconciliation are not implemented in this patch.
- API keys: key management exists, but scoped API authentication still needs implementation. The plan check does not create an integration API.
- Concurrency: employee seat creation/reactivation, leave approvals and comp-off balances still need atomic transitions and real database tests.
- Offline timestamp policy, durable event replay IDs and full lifecycle tests remain.
- Employee/candidate document storage delivery authorization and expiring download access remain to be verified; this upload fix does not claim private Cloudinary delivery.
- Candidate token expiry/revocation lifecycle remains. Terminal candidate states now block new uploads.
- No merge, production deployment or database changes were performed.

## Neon verification checklist

The user connected Neon during implementation, but no Neon operations were exposed to the running tool registry. Do not mistake connection confirmation for executed database tests.

When operations are available:
1. Identify the project containing the WorkPulse tables; inspect branches and use schema/migration metadata first.
2. Read migration names, checksums, finished/rolled-back status and failed logs from `_prisma_migrations` without exposing customer rows.
3. Create a disposable schema-only test branch or isolated test database with synthetic data.
4. Compare the current schema with `schema.prisma`. Test the chosen fresh-install and upgrade strategies separately.
5. Exercise payment verification/webhook concurrency, attendance duplicates, two-tenant permissions and subscription recovery.
6. Record exact applied migration IDs, query results and rollback/restore procedure before production release.
