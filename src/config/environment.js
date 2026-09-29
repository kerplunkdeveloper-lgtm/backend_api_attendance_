const requiredOneOf = (names) => {
  if (names.some((name) => String(process.env[name] || "").trim())) return;
  throw new Error(`Missing required environment variable: ${names.join(" or ")}`);
};

const validateUrl = (name) => {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol)) throw new Error("unsupported protocol");
  } catch {
    throw new Error(`${name} must be an absolute HTTP(S) URL`);
  }
};

const validateEnvironment = () => {
  if (process.env.NODE_ENV !== "production") return;
  validateUrl("FRONTEND_URL");
  requiredOneOf(["ACCESS_TOKEN_SECRET", "JWT_SECRET"]);
  requiredOneOf(["REFRESH_TOKEN_SECRET", "JWT_REFRESH_SECRET"]);
  requiredOneOf(["RESET_PASSWORD_SECRET", "JWT_SECRET"]);
};

module.exports = { validateEnvironment };
