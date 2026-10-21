const { AsyncLocalStorage } = require("async_hooks");

/**
 * Per-request tenant scope. `requestContext` opens an empty store for every
 * request; `authenticate` fills in the caller's organization once it is known.
 * The Prisma tenant guard reads it, so a service that forgets an
 * `organizationId` filter still cannot touch another company's rows.
 *
 * No store (scheduler, scripts, webhooks) or no organization yet (login,
 * refresh, public onboarding links) means queries run unscoped, exactly as
 * before the guard existed.
 */
const storage = new AsyncLocalStorage();

const runWithRequestStore = (fn) => storage.run({ organizationId: null }, fn);

const setTenant = (organizationId) => {
  const store = storage.getStore();
  if (store) store.organizationId = organizationId || null;
};

const getTenantId = () => storage.getStore()?.organizationId || null;

/**
 * Deliberate cross-tenant work inside a request (platform console, global
 * uniqueness checks) must opt out explicitly so it is visible in review.
 */
const runUnscoped = (fn) => storage.run({ organizationId: null }, fn);

module.exports = { runWithRequestStore, setTenant, getTenantId, runUnscoped };
