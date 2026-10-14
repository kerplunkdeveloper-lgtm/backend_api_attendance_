const ssoService = require("../services/sso.service");
const { sendControllerError } = require("../utils/controllerError");

const frontendUrl = () => String(process.env.FRONTEND_URL || "http://localhost:3000").replace(/\/$/, "");
const cookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
  path: '/',
  maxAge: 7 * 24 * 60 * 60 * 1000,
});

module.exports = {
  async discover(req, res) {
    try {
      return res.json({ success: true, ...(await ssoService.discoverForEmail(req.body.email)) });
    } catch (error) {
      return sendControllerError(res, error);
    }
  },
  async start(req, res) {
    try {
      const result = await ssoService.start(req.params.organizationId);
      return res.redirect(result.url);
    } catch (error) {
      return sendControllerError(res, error);
    }
  },
  async callback(req, res) {
    try {
      const result = await ssoService.finishCallback({ code: req.query.code, state: req.query.state });
      return res.redirect(`${frontendUrl()}/sso/callback?code=${encodeURIComponent(result.code)}`);
    } catch (error) {
      const code = error.code || "SSO_FAILED";
      return res.redirect(`${frontendUrl()}/sso/callback?error=${encodeURIComponent(code)}`);
    }
  },
  async exchange(req, res) {
    try {
      const result = await ssoService.exchange(req.body.code);
      if (result.refreshToken) res.cookie("refreshToken", result.refreshToken, cookieOptions());
      const { refreshToken, ...safeResult } = result;
      return res.json({ success: true, data: safeResult });
    } catch (error) {
      return sendControllerError(res, error);
    }
  },
};
