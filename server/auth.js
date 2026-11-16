/* Passwords, tokens, cookies and rate limiting. No database access here.
   - Passwords: scrypt with a random salt, stored as "scrypt$N$salt$hash" so the cost can be raised later
     without breaking old hashes (verifyPassword reads N from the stored value).
   - Tokens (sessions, password resets, share links): random bytes. Only their SHA-256 is stored, so a leaked
     database can't be used to log in.
   - rateLimiter: counts per key in memory. It resets on restart and isn't shared between processes,
     which is one reason the app must run as a single instance. */
import crypto from "node:crypto";

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
export const SESSION_COOKIE = "ut_session";
export const SESSION_DAYS = 30;

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

export function verifyPassword(password, stored) {
  const [scheme, n, saltB64, hashB64] = String(stored).split("$");
  if (scheme !== "scrypt") return false;
  const expected = Buffer.from(hashB64, "base64url");
  const actual = crypto.scryptSync(password, Buffer.from(saltB64, "base64url"), expected.length, { N: Number(n), r: SCRYPT.r, p: SCRYPT.p });
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

export const newId = () => crypto.randomBytes(9).toString("base64url");
export const newToken = (bytes = 32) => crypto.randomBytes(bytes).toString("base64url");
export const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");

export function parseCookies(header) {
  const out = {};
  for (const part of String(header || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/** Simple fixed-window limiter kept in memory: fine for one server process. */
export function rateLimiter({ max, windowMs }) {
  const hits = new Map();
  return (key) => {
    const now = Date.now();
    const entry = hits.get(key);
    if (!entry || now - entry.start > windowMs) {
      hits.set(key, { start: now, count: 1 });
      if (hits.size > 10000) for (const [k, v] of hits) if (now - v.start > windowMs) hits.delete(k);
      return true;
    }
    entry.count += 1;
    return entry.count <= max;
  };
}
