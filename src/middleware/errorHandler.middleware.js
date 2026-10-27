/**
 * Last-resort Express error handler.
 *
 * Clients get the same JSON shape as before. What changes is what reaches the
 * logs and what is kept out of the response:
 *  - routine client errors (an expired link, a bad token, a failed validation)
 *    are one warning line, not a stack trace, so real faults stand out;
 *  - only genuine server faults (5xx) log the full error;
 *  - driver and database codes (P2002, ECONNREFUSED) describe our internals,
 *    so only client errors carry a `code` back to the caller.
 * Request URLs are not logged here: some carry secrets (invite and reset tokens).
 */

const logger = require("../utils/logger");

const statusOf = (err) => {
  const raw = Number(err?.statusCode ?? err?.status);
  return Number.isInteger(raw) && raw >= 400 && raw <= 599 ? raw : 500;
};

// Express identifies an error handler by its four parameters, so `next` must stay.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function errorHandler(err, req, res, next) {
  // A response that has already started (a streamed PDF, say) cannot take a JSON
  // error body; hand it back so Express can close the connection.
  if (res.headersSent) return next(err);

  if (err && err.message === "Not allowed by CORS") {
    return res.status(403).json({ success: false, message: "Origin not allowed" });
  }

  const statusCode = statusOf(err);
  const route = req.route?.path ?? "-";
  if (statusCode >= 500) {
    logger.error("http.request_failed", { requestId: req.requestId, method: req.method, route, status: statusCode, error: err });
  } else {
    logger.warn("http.client_error", { requestId: req.requestId, method: req.method, route, status: statusCode, error: err });
  }

  const hideDetail = statusCode >= 500 && process.env.NODE_ENV === "production";
  return res.status(statusCode).json({
    success: false,
    message: hideDetail ? "Internal Server Error" : err?.message || "Internal Server Error",
    ...(err?.code && statusCode < 500 && { code: err.code }),
    requestId: req.requestId,
    ...(process.env.NODE_ENV === "development" && { stack: err?.stack }),
  });
}

module.exports = { errorHandler, statusOf };
