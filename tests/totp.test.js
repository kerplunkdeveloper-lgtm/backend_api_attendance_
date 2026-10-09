const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const t = require("../src/utils/totp");

// RFC 6238 appendix B: SHA-1 secret "12345678901234567890" (6-digit truncations).
const RFC_SECRET = t.base32Encode(Buffer.from("12345678901234567890"));

describe("totp", () => {
  it("matches the RFC 6238 test vectors", () => {
    assert.equal(RFC_SECRET, "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    assert.equal(t.totp(RFC_SECRET, 59 * 1000), "287082");
    assert.equal(t.totp(RFC_SECRET, 1111111109 * 1000), "081804");
    assert.equal(t.totp(RFC_SECRET, 1111111111 * 1000), "050471");
    assert.equal(t.totp(RFC_SECRET, 1234567890 * 1000), "005924");
    assert.equal(t.totp(RFC_SECRET, 2000000000 * 1000), "279037");
  });

  it("round-trips base32", () => {
    const secret = t.generateSecret();
    assert.match(secret, /^[A-Z2-7]{32}$/);
    assert.equal(t.base32Encode(t.base32Decode(secret)), secret);
  });

  it("accepts the current code and one step of clock drift, but not more", () => {
    const now = 1700000000000;
    const code = t.totp(RFC_SECRET, now);
    assert.ok(t.verifyTotp(RFC_SECRET, code, { timeMs: now }) !== null);
    assert.ok(t.verifyTotp(RFC_SECRET, code, { timeMs: now + 30000 }) !== null);
    assert.ok(t.verifyTotp(RFC_SECRET, code, { timeMs: now - 30000 }) !== null);
    assert.equal(t.verifyTotp(RFC_SECRET, code, { timeMs: now + 95000 }), null);
  });

  it("rejects wrong, malformed and replayed codes", () => {
    const now = 1700000000000;
    const code = t.totp(RFC_SECRET, now);
    assert.equal(t.verifyTotp(RFC_SECRET, "000000", { timeMs: now }), null);
    assert.equal(t.verifyTotp(RFC_SECRET, "12345", { timeMs: now }), null);
    assert.equal(t.verifyTotp(RFC_SECRET, "abcdef", { timeMs: now }), null);
    const step = t.verifyTotp(RFC_SECRET, code, { timeMs: now });
    assert.equal(t.verifyTotp(RFC_SECRET, code, { timeMs: now, afterStep: step }), null);
  });

  it("encrypts secrets at rest and detects tampering", () => {
    process.env.TWO_FACTOR_ENC_KEY = "test-key-for-unit-tests";
    const packed = t.encryptSecret("JBSWY3DPEHPK3PXP");
    assert.notEqual(packed.includes("JBSWY3DPEHPK3PXP"), true);
    assert.equal(t.decryptSecret(packed), "JBSWY3DPEHPK3PXP");
    const parts = packed.split(":");
    parts[3] = Buffer.from("tampered").toString("base64url");
    assert.throws(() => t.decryptSecret(parts.join(":")));
  });

  it("generates unique, readable, single-use backup codes", () => {
    const codes = t.generateBackupCodes();
    assert.equal(codes.length, 10);
    assert.equal(new Set(codes).size, 10);
    codes.forEach((c) => assert.match(c, /^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/));
    assert.equal(t.hashBackupCode(codes[0]), t.hashBackupCode(codes[0].toLowerCase().replace("-", " ")));
    assert.notEqual(t.hashBackupCode(codes[0]), t.hashBackupCode(codes[1]));
  });

  it("builds an otpauth URL authenticator apps understand", () => {
    const url = t.otpauthUrl({ issuer: "WorkPulse", account: "owner@x.com", secret: "ABC" });
    assert.equal(url, "otpauth://totp/WorkPulse:owner%40x.com?secret=ABC&issuer=WorkPulse&algorithm=SHA1&digits=6&period=30");
  });
});
