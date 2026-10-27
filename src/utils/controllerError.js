const logger = require("./logger");

const infrastructureCodes = new Set(["EACCES", "ECONNREFUSED", "ETIMEDOUT", "ENOTFOUND", "ECONNRESET"]);

const isUnexpectedServerError = (error) => {
  const code = String(error?.code || "");
  const name = String(error?.name || "");
  return name.startsWith("PrismaClient") || code.startsWith("P") || infrastructureCodes.has(code);
};

function sendControllerError(res, error, { fallbackStatus = 400, fallbackMessage = "Request could not be completed" } = {}) {
  const explicit = Number(error?.statusCode);
  const serverFailure = !Number.isInteger(explicit) && isUnexpectedServerError(error);
  const status = serverFailure ? 500 : (Number.isInteger(explicit) && explicit >= 400 && explicit < 600 ? explicit : fallbackStatus);
  if (status >= 500) {
    logger.error("controller.request_failed", { requestId: res.req?.requestId, method: res.req?.method, route: res.req?.route?.path || res.req?.baseUrl, status, error });
  }
  return res.status(status).json({
    success: false,
    message: status >= 500 ? "Internal Server Error" : error?.message || fallbackMessage,
    ...(error?.code && status < 500 ? { code: error.code } : {}),
    ...(res.req?.requestId ? { requestId: res.req.requestId } : {}),
  });
}

module.exports = { sendControllerError, isUnexpectedServerError };
