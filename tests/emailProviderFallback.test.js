const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const emailService = require("../src/services/email.service");

const stub = (name, ready, impl) => ({ isReady: () => ready, sendEmail: impl, name });

describe("email provider fallback", () => {
  it("uses Gmail first when configured", async () => {
    const prev = [emailService.gmailService, emailService.brevoService];
    let brevoCalled = false;
    emailService.gmailService = stub("g", true, async () => ({ success: true, id: "g1" }));
    emailService.brevoService = stub("b", true, async () => { brevoCalled = true; return { success: true, id: "b1" }; });
    const r = await emailService.sendEmail({ to: "a@b.com", subject: "OTP", html: "<p>1</p>" });
    [emailService.gmailService, emailService.brevoService] = prev;
    assert.equal(r.success, true);
    assert.equal(r.provider, "GMAIL");
    assert.equal(brevoCalled, false);
  });

  it("falls back to Brevo when Gmail fails, even in production", async () => {
    const prev = [emailService.gmailService, emailService.brevoService, process.env.NODE_ENV];
    process.env.NODE_ENV = "production";
    emailService.gmailService = stub("g", true, async () => ({ success: false, error: "auth failed" }));
    emailService.brevoService = stub("b", true, async () => ({ success: true, id: "b1" }));
    const r = await emailService.sendEmail({ to: "a@b.com", subject: "OTP", html: "<p>1</p>" });
    [emailService.gmailService, emailService.brevoService] = prev;
    process.env.NODE_ENV = prev[2];
    assert.equal(r.success, true);
    assert.equal(r.provider, "BREVO");
  });

  it("reports failure in production when every provider fails", async () => {
    const prev = [emailService.gmailService, emailService.brevoService, process.env.NODE_ENV];
    process.env.NODE_ENV = "production";
    emailService.gmailService = stub("g", true, async () => ({ success: false, error: "auth failed" }));
    emailService.brevoService = stub("b", true, async () => { throw new Error("down"); });
    const r = await emailService.sendEmail({ to: "a@b.com", subject: "OTP", html: "<p>1</p>" });
    [emailService.gmailService, emailService.brevoService] = prev;
    process.env.NODE_ENV = prev[2];
    assert.equal(r.success, false);
  });
});
