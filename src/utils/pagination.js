/**
 * Small, shared pagination helpers for list endpoints.
 *
 * Every list endpoint should accept `page` (1-based) and `limit` and return
 * { data, page, limit, total, totalPages } so clients can render paged lists
 * without re-fetching everything.
 */

const parsePagination = (query = {}, { defaultLimit = 20, maxLimit = 500 } = {}) => {
  const page = Math.max(1, parseInt(query?.page, 10) || 1);
  const raw = parseInt(query?.limit, 10);
  const limit = Math.min(Math.max(1, raw || defaultLimit), maxLimit);
  return { page, limit, skip: (page - 1) * limit };
};

const paginationMeta = (total, page, limit) => ({
  total,
  page,
  limit,
  totalPages: Math.max(1, Math.ceil(total / limit)),
});

module.exports = { parsePagination, paginationMeta };