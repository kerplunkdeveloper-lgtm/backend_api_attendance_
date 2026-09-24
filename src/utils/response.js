/**
 * Response envelope helpers.
 *
 * Controllers historically returned three different shapes — `{ data }`,
 * `{ records, total }`, and bare service objects — while the clients uniformly
 * read `res.data`. That mismatch rendered several screens empty with no error.
 *
 * These helpers emit one canonical shape. Legacy keys (`records`, and any other
 * keys the service already returned) are preserved alongside `data` so existing
 * clients keep working while they migrate.
 */

/** A single resource or a plain list. */
const ok = (res, data, extra = {}) =>
  res.status(200).json({ success: true, data, ...extra });

const created = (res, data, message, extra = {}) =>
  res.status(201).json({ success: true, message, data, ...extra });

/**
 * A paginated service result of the form `{ records, total, page, totalPages }`.
 * Mirrors `records` onto `data` so both envelopes resolve to the same array.
 */
const paginated = (res, result, extra = {}) => {
  const records = result?.records ?? [];
  return res.status(200).json({
    success: true,
    ...result,
    data: records,
    records,
    pagination: {
      total: result?.total ?? records.length,
      page: result?.page ?? 1,
      totalPages: result?.totalPages ?? 1,
    },
    ...extra,
  });
};

const fail = (res, error, fallbackStatus = 500) =>
  res.status(error?.statusCode || fallbackStatus).json({
    success: false,
    message: error?.message || "Unexpected error",
  });

module.exports = { ok, created, paginated, fail };
