const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const sso = require("../src/services/sso.service");

describe("OIDC SSO configuration", () => {
  it("returns only safe configuration metadata and a public callback URL", () => {
    const previous = process.env.BACKEND_URL;
    process.env.BACKEND_URL = "https://api.example.com";
    const result = sso.getConfiguration({
      ssoEnabled: true,
      ssoIssuer: "https://idp.example.com",
      ssoClientId: "client-123",
      ssoClientSecretCiphertext: "encrypted-secret",
      ssoEmailDomain: "example.com",
    });
    assert.deepEqual(result, {
      enabled: true,
      issuer: "https://idp.example.com",
      clientId: "client-123",
      emailDomain: "example.com",
      configured: true,
      callbackUrl: "https://api.example.com/api/auth/sso/callback",
    });
    assert.equal(JSON.stringify(result).includes("encrypted-secret"), false);
    if (previous === undefined) delete process.env.BACKEND_URL; else process.env.BACKEND_URL = previous;
  });

  it("does not report incomplete provider settings as configured", () => {
    const result = sso.getConfiguration({ ssoEnabled: true, ssoIssuer: "https://idp.example.com", ssoClientId: "client-123" });
    assert.equal(result.enabled, true);
    assert.equal(result.configured, false);
  });

  it("keeps the SSO refresh token in an HTTP-only cookie", async () => {
    const controller = require("../src/controllers/sso.controller");
    const originalExchange = sso.exchange;
    const response = {
      cookies: [],
      body: null,
      cookie(name, value, options) { this.cookies.push({ name, value, options }); return this; },
      json(body) { this.body = body; return this; },
    };
    sso.exchange = async () => ({ accessToken: "access", refreshToken: "refresh-secret", user: { id: "u1" } });
    try {
      await controller.exchange({ body: { code: "one-time-code" } }, response);
      assert.equal(response.cookies.length, 1);
      assert.equal(response.cookies[0].name, "refreshToken");
      assert.equal(response.cookies[0].options.httpOnly, true);
      assert.equal(response.body.data.refreshToken, undefined);
      assert.equal(response.body.data.accessToken, "access");
    } finally {
      sso.exchange = originalExchange;
    }
  });});
