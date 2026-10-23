const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const prisma = require("../config/database");
const authService = require("./auth.service");
const { organizationWithSubscription } = require("../utils/prismaSelects");
const { presentAuthUser } = require("./entitlement.service");
const { encryptSecret, decryptSecret } = require("../utils/totp");
const { generateAccessToken, verifyAccessToken, generateTwoFactorChallengeToken } = require("../utils/jwt");

const CALLBACK_PATH = "/api/auth/sso/callback";
const DISCOVERY_TTL_MS = 5 * 60 * 1000;
const discoveryCache = new Map();

const httpError = (message, statusCode = 400, code) => Object.assign(new Error(message), { statusCode, code });

const normalizeIssuer = (value) => {
  const url = new URL(String(value).trim());
  if (url.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && url.hostname === "localhost")) {
    throw httpError("SSO issuer must use HTTPS.", 400);
  }
  return url.toString().replace(/\/$/, "");
};

const callbackUrl = () => {
  const base = String(process.env.BACKEND_PUBLIC_URL || process.env.BACKEND_URL || "http://localhost:5000").trim().replace(/\/$/, "");
  return `${base}${CALLBACK_PATH}`;
};

const hashCode = (value) => crypto.createHash("sha256").update(String(value)).digest("hex");

const getOrganizationConfig = async (organizationId) => {
  const organization = await prisma.organization.findUnique({ where: { id: organizationId } });
  if (!organization || !organization.ssoEnabled) throw httpError("Single sign-on is not enabled for this workspace.", 404, "SSO_NOT_ENABLED");
  if (!organization.ssoIssuer || !organization.ssoClientId || !organization.ssoClientSecretCiphertext) {
    throw httpError("Single sign-on is not configured correctly. Contact your administrator.", 503, "SSO_MISCONFIGURED");
  }
  return {
    organization,
    issuer: normalizeIssuer(organization.ssoIssuer),
    clientId: organization.ssoClientId,
    clientSecret: decryptSecret(organization.ssoClientSecretCiphertext),
    emailDomain: organization.ssoEmailDomain ? organization.ssoEmailDomain.toLowerCase() : null,
  };
};

const discover = async (issuer) => {
  const cached = discoveryCache.get(issuer);
  if (cached && cached.expiresAt > Date.now()) return cached.metadata;
  const response = await fetch(`${issuer}/.well-known/openid-configuration`, { headers: { accept: "application/json" } });
  if (!response.ok) throw httpError("The identity provider discovery endpoint is unavailable.", 503, "SSO_PROVIDER_UNAVAILABLE");
  const metadata = await response.json();
  if (!metadata.authorization_endpoint || !metadata.token_endpoint || !metadata.jwks_uri || metadata.issuer !== issuer) {
    throw httpError("The identity provider returned an incomplete OIDC configuration.", 503, "SSO_PROVIDER_INVALID");
  }
  discoveryCache.set(issuer, { metadata, expiresAt: Date.now() + DISCOVERY_TTL_MS });
  return metadata;
};

const start = async (organizationId) => {
  const config = await getOrganizationConfig(organizationId);
  const metadata = await discover(config.issuer);
  const statePayload = {
    type: "sso_state",
    organizationId,
    nonce: crypto.randomBytes(24).toString("base64url"),
    codeVerifier: crypto.randomBytes(32).toString("base64url"),
  };
  const state = generateAccessToken(statePayload);
  const challenge = crypto.createHash("sha256").update(statePayload.codeVerifier).digest("base64url");
  const authorization = new URL(metadata.authorization_endpoint);
  authorization.search = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: callbackUrl(),
    scope: "openid email profile",
    state,
    nonce: statePayload.nonce,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();
  return { url: authorization.toString() };
};

const discoverForEmail = async (email) => {
  const cleanEmail = String(email || "").trim().toLowerCase();
  if (!cleanEmail || !cleanEmail.includes("@")) return { enabled: false };
  const user = await prisma.user.findFirst({
    where: { email: { equals: cleanEmail, mode: "insensitive" }, organization: { ssoEnabled: true } },
    select: { organizationId: true },
  });
  if (!user) return { enabled: false };
  const configuration = await getOrganizationConfig(user.organizationId);
  return { enabled: true, startUrl: (await start(configuration.organization.id)).url };
};

const parseJwt = (token) => {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) throw httpError("The identity provider returned an invalid token.", 401, "SSO_INVALID_TOKEN");
  try {
    return { header: JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")), payload: JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) };
  } catch {
    throw httpError("The identity provider returned an invalid token.", 401, "SSO_INVALID_TOKEN");
  }
};

const verifyIdToken = async (idToken, config, metadata, expectedNonce) => {
  const decoded = parseJwt(idToken);
  const keysResponse = await fetch(metadata.jwks_uri, { headers: { accept: "application/json" } });
  if (!keysResponse.ok) throw httpError("The identity provider signing keys are unavailable.", 503, "SSO_PROVIDER_UNAVAILABLE");
  const jwks = await keysResponse.json();
  const jwk = (jwks.keys || []).find((candidate) => candidate.kid === decoded.header.kid);
  if (!jwk) throw httpError("The identity provider token could not be verified.", 401, "SSO_INVALID_TOKEN");
  let claims;
  try {
    const key = crypto.createPublicKey({ key: jwk, format: "jwk" });
    claims = jwt.verify(idToken, key, {
      algorithms: ["RS256", "RS384", "RS512", "PS256", "PS384", "PS512", "ES256", "ES384", "ES512"],
      issuer: config.issuer,
      audience: config.clientId,
    });
  } catch {
    throw httpError("The identity provider token could not be verified.", 401, "SSO_INVALID_TOKEN");
  }
  if (!claims.sub || claims.nonce !== expectedNonce || !claims.email || claims.email_verified !== true) {
    throw httpError("The identity provider account is not verified.", 401, "SSO_UNVERIFIED_ACCOUNT");
  }
  const email = String(claims.email).trim().toLowerCase();
  if (config.emailDomain && email.split("@")[1] !== config.emailDomain) {
    throw httpError("This identity provider account is outside the workspace email domain.", 403, "SSO_DOMAIN_NOT_ALLOWED");
  }
  return { email, subject: String(claims.sub), claims };
};

const finishCallback = async ({ code, state }) => {
  if (!code || !state) throw httpError("The SSO response is incomplete.", 400, "SSO_INVALID_RESPONSE");
  let statePayload;
  try {
    statePayload = verifyAccessToken(state);
  } catch {
    throw httpError("The SSO sign-in session expired. Please try again.", 400, "SSO_STATE_EXPIRED");
  }
  if (statePayload?.type !== "sso_state" || !statePayload.organizationId || !statePayload.codeVerifier) {
    throw httpError("The SSO sign-in state is invalid.", 400, "SSO_INVALID_STATE");
  }
  const config = await getOrganizationConfig(statePayload.organizationId);
  const metadata = await discover(config.issuer);
  const tokenResponse = await fetch(metadata.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: callbackUrl(),
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code_verifier: statePayload.codeVerifier,
    }),
  });
  if (!tokenResponse.ok) throw httpError("The identity provider rejected the SSO sign-in.", 401, "SSO_TOKEN_EXCHANGE_FAILED");
  const tokens = await tokenResponse.json();
  const identity = await verifyIdToken(tokens.id_token, config, metadata, statePayload.nonce);
  const user = await prisma.user.findFirst({
    where: { organizationId: config.organization.id, email: { equals: identity.email, mode: "insensitive" } },
    include: { organization: organizationWithSubscription, employee: { include: { branch: true, shift: true, department: true } } },
  });
  if (!user) throw httpError("No WorkPluse account uses this SSO email. Ask your administrator to invite you first.", 404, "SSO_ACCOUNT_NOT_FOUND");
  if (!user.isActive) throw httpError("This WorkPluse account has been deactivated.", 403, "ACCOUNT_INACTIVE");
  if (user.role === "EMPLOYEE") throw httpError("Web access is for admins and HR. Use the mobile app.", 403, "WEB_EMPLOYEE_ACCESS_DISABLED");
  const rawCode = crypto.randomBytes(32).toString("base64url");
  await prisma.ssoLoginCode.deleteMany({ where: { OR: [{ userId: user.id }, { expiresAt: { lt: new Date() } }] } });
  await prisma.ssoLoginCode.create({ data: { codeHash: hashCode(rawCode), userId: user.id, organizationId: user.organizationId, expiresAt: new Date(Date.now() + 60 * 1000) } });
  return { code: rawCode };
};

const exchange = async (rawCode) => {
  if (!rawCode) throw httpError("SSO exchange code is required.", 400);
  const record = await prisma.ssoLoginCode.findUnique({ where: { codeHash: hashCode(rawCode) }, include: { user: { include: { organization: organizationWithSubscription, employee: { include: { branch: true, shift: true, department: true } } } } } });
  if (!record || record.usedAt || record.expiresAt <= new Date()) throw httpError("The SSO exchange code is invalid or expired.", 401, "SSO_CODE_EXPIRED");
  const claimed = await prisma.ssoLoginCode.updateMany({ where: { id: record.id, usedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() } });
  if (claimed.count !== 1) throw httpError("The SSO exchange code is invalid or expired.", 401, "SSO_CODE_EXPIRED");
  const user = record.user;
  if (user.twoFactorEnabledAt) return { twoFactorRequired: true, challengeToken: generateTwoFactorChallengeToken({ userId: user.id, organizationId: user.organizationId, role: user.role, sso: true }) };
  const tokenPayload = { userId: user.id, organizationId: user.organizationId, role: user.role };
  const accessToken = generateAccessToken(tokenPayload);
  const refreshToken = await authService.issueRefreshToken(user.id, tokenPayload);
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date(), ...(user.emailVerifiedAt ? {} : { emailVerifiedAt: new Date() }) } });
  return { accessToken, token: accessToken, refreshToken, user: presentAuthUser(user) };
};

const getConfiguration = (organization) => ({
  enabled: Boolean(organization?.ssoEnabled),
  issuer: organization?.ssoIssuer || null,
  clientId: organization?.ssoClientId || null,
  emailDomain: organization?.ssoEmailDomain || null,
  configured: Boolean(organization?.ssoEnabled && organization?.ssoIssuer && organization?.ssoClientId && organization?.ssoClientSecretCiphertext),
  callbackUrl: callbackUrl(),
});

const updateConfiguration = async (organizationId, payload) => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw httpError("Invalid SSO configuration.", 400);
  const enabled = Boolean(payload.enabled);
  const issuer = payload.issuer ? normalizeIssuer(payload.issuer) : null;
  const clientId = payload.clientId ? String(payload.clientId).trim() : null;
  const emailDomain = payload.emailDomain ? String(payload.emailDomain).trim().toLowerCase().replace(/^@/, "") : null;
  if (enabled && (!issuer || !clientId || !emailDomain)) throw httpError("Enabled SSO requires issuer, client ID, and an email domain.", 400);
  if (emailDomain && !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(emailDomain)) throw httpError("Enter a valid company email domain.", 400);
  const data = { ssoEnabled: enabled, ssoIssuer: issuer, ssoClientId: clientId, ssoEmailDomain: emailDomain };
  if (payload.clientSecret) data.ssoClientSecretCiphertext = encryptSecret(String(payload.clientSecret));
  if (!enabled) data.ssoClientSecretCiphertext = null;
  if (enabled && !payload.clientSecret) {
    const current = await prisma.organization.findUnique({ where: { id: organizationId }, select: { ssoClientSecretCiphertext: true } });
    if (!current?.ssoClientSecretCiphertext) throw httpError("Enabled SSO requires a client secret.", 400);
  }
  const organization = await prisma.organization.update({ where: { id: organizationId }, data });
  discoveryCache.delete(issuer);
  return getConfiguration(organization);
};

module.exports = { start, discoverForEmail, finishCallback, exchange, getConfiguration, updateConfiguration, CALLBACK_PATH };
