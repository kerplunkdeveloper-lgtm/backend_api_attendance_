const crypto = require("crypto");

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const STEP_MS = 30_000;
const DIGITS = 6;

function base32Encode(input) {
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input);
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

function base32Decode(input) {
  const normalized = String(input || "").replace(/[\s=-]/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const char of normalized) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index < 0) throw new Error("Invalid base32 secret");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function generateSecret() {
  return base32Encode(crypto.randomBytes(20));
}

function totp(secret, timeMs = Date.now()) {
  const counter = Math.floor(Number(timeMs) / STEP_MS);
  const buffer = Buffer.alloc(8);
  buffer.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buffer.writeUInt32BE(counter >>> 0, 4);
  const digest = crypto.createHmac("sha1", base32Decode(secret)).update(buffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const code = ((digest.readUInt32BE(offset) & 0x7fffffff) % 10 ** DIGITS).toString().padStart(DIGITS, "0");
  return code;
}

function verifyTotp(secret, code, { timeMs = Date.now(), afterStep = null } = {}) {
  if (!/^\d{6}$/.test(String(code || ""))) return null;
  const currentStep = Math.floor(Number(timeMs) / STEP_MS);
  for (const drift of [-1, 0, 1]) {
    const step = currentStep + drift;
    if (afterStep !== null && step <= afterStep) continue;
    const candidate = totp(secret, step * STEP_MS);
    if (crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(String(code)))) return step;
  }
  return null;
}

function encryptionKey() {
  return crypto.createHash("sha256").update(String(process.env.TWO_FACTOR_ENC_KEY || process.env.JWT_SECRET || "workpulse-local-key")).digest();
}

function encryptSecret(secret) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(secret), "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(":");
}

function decryptSecret(packed) {
  const [version, ivText, tagText, dataText] = String(packed || "").split(":");
  if (version !== "v1" || !ivText || !tagText || !dataText) throw new Error("Invalid encrypted secret");
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivText, "base64url"));
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(dataText, "base64url")), decipher.final()]).toString("utf8");
}

function generateBackupCodes() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 10 }, () => {
    const makePart = () => Array.from({ length: 5 }, () => alphabet[crypto.randomInt(alphabet.length)]).join("");
    return `${makePart()}-${makePart()}`;
  });
}

function hashBackupCode(code) {
  return crypto.createHash("sha256").update(String(code || "").toUpperCase().replace(/[\s-]/g, "")).digest("hex");
}

function otpauthUrl({ issuer, account, secret }) {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${encodeURIComponent(secret)}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

module.exports = { base32Encode, base32Decode, generateSecret, totp, verifyTotp, encryptSecret, decryptSecret, generateBackupCodes, hashBackupCode, otpauthUrl };
