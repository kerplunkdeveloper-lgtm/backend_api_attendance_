const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const environment = require("../src/config/environment");

const required = {
  NODE_ENV: "production",
  APP_ENV: "production",
  DATABASE_URL: "postgresql://user:pass@localhost:5432/workpulse",
  FRONTEND_URL: "https://app.example.com",
  BACKEND_URL: "https://api.example.com",
  ACCESS_TOKEN_SECRET: "access-secret",
  REFRESH_TOKEN_SECRET: "refresh-secret",
  RESET_PASSWORD_SECRET: "reset-secret",
  DIRECT_URL: "postgresql://user:pass@localhost:5432/workpulse",
  CLOUDINARY_CLOUD_NAME: "cloud",
  CLOUDINARY_API_KEY: "key",
  CLOUDINARY_API_SECRET: "secret",
  RAZORPAY_KEY_ID: "rzp_live_key",
  RAZORPAY_KEY_SECRET: "secret",
  RAZORPAY_WEBHOOK_SECRET: "secret",
  BREVO_API_KEY: "brevo-key",
  BREVO_FROM_EMAIL: "notifications@example.com",
};

describe("production environment validation", () => {
  it("accepts a complete production configuration", () => {
    const previous = {};
    for (const [key, value] of Object.entries(required)) { previous[key] = process.env[key]; process.env[key] = value; }
    const previousCors = process.env.CORS_ALLOWED_ORIGINS;
    delete process.env.CORS_ALLOWED_ORIGINS;
    assert.doesNotThrow(() => environment.validateEnvironment());
    if (previousCors === undefined) delete process.env.CORS_ALLOWED_ORIGINS; else process.env.CORS_ALLOWED_ORIGINS = previousCors;
    for (const key of Object.keys(required)) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; }
  });

  it("rejects private network CORS origins in production", () => {
    const previous = {};
    for (const [key, value] of Object.entries(required)) { previous[key] = process.env[key]; process.env[key] = value; }
    const previousCors = process.env.CORS_ALLOWED_ORIGINS;
    process.env.CORS_ALLOWED_ORIGINS = "https://app.example.com,http://localhost:3000";
    assert.throws(() => environment.validateEnvironment(), /CORS_ALLOWED_ORIGINS cannot contain localhost/);
    if (previousCors === undefined) delete process.env.CORS_ALLOWED_ORIGINS; else process.env.CORS_ALLOWED_ORIGINS = previousCors;
    for (const key of Object.keys(required)) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; }
  });

  it("rejects Razorpay test keys in production", () => {
    const previous = {};
    for (const [key, value] of Object.entries(required)) { previous[key] = process.env[key]; process.env[key] = value; }
    const previousCors = process.env.CORS_ALLOWED_ORIGINS;
    const previousKey = process.env.RAZORPAY_KEY_ID;
    delete process.env.CORS_ALLOWED_ORIGINS;
    process.env.RAZORPAY_KEY_ID = "rzp_test_local_only";
    assert.throws(() => environment.validateEnvironment(), /Production must use Razorpay LIVE credentials/);
    process.env.RAZORPAY_KEY_ID = previousKey;
    if (previousCors === undefined) delete process.env.CORS_ALLOWED_ORIGINS; else process.env.CORS_ALLOWED_ORIGINS = previousCors;
    for (const key of Object.keys(required)) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; }
  });});
