const REDACTED = "[REDACTED]";
const SENSITIVE_KEY = /(authorization|cookie|token|secret|password|api[-_]?key|refresh|reset|code)/i;
const redactText = (text) => String(text).replace(/(bearer\s+|token[=:]\s*|[?&](?:token|code|key|secret|password)=)[^\s&]+/gi, "$1[REDACTED]");
const safeValue = (value, depth = 0) => {
  if (depth > 2) return "[TRUNCATED]";
  if (value instanceof Error) return { name: value.name, message: redactText(value.message), code: value.code };
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => safeValue(item, depth + 1));
  if (!value || typeof value !== "object") return typeof value === "string" ? redactText(value) : value;
  return Object.fromEntries(Object.entries(value).slice(0, 40).map(([key, child]) => [key, SENSITIVE_KEY.test(key) ? REDACTED : safeValue(child, depth + 1)]));
};
const write = (level, event, fields = {}) => {
  const record = { timestamp: new Date().toISOString(), level, event, ...safeValue(fields) };
  const line = JSON.stringify(record);
  if (level === "error") console.error(line); else if (level === "warn") console.warn(line); else console.log(line);
};
module.exports = { info: (event, fields) => write("info", event, fields), warn: (event, fields) => write("warn", event, fields), error: (event, fields) => write("error", event, fields), safeValue };