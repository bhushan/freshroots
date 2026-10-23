import { createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "fr_session";
export const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const MIN_SECRET_LENGTH = 32;

export interface AuthEnv {
  ADMIN_PASSWORD?: string;
  SESSION_SECRET?: string;
}

export type AdminCheck =
  | { ok: true }
  | { ok: false; status: 401 | 403; code: "DEMO_READ_ONLY" | "NOT_CONFIGURED" | "UNAUTHENTICATED"; message: string };

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** `<base64url payload>.<hmac>`; the payload carries only an expiry, never the password. */
export function createSessionToken(secret: string, now = new Date()): string {
  const payload = Buffer.from(JSON.stringify({ exp: now.getTime() + SESSION_TTL_MS })).toString("base64url");
  return `${payload}.${sign(payload, secret)}`;
}

export function verifySessionToken(token: string | undefined, secret: string, now = new Date()): boolean {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const [payload, signature] = parts;
  if (!safeEqual(signature, sign(payload, secret))) return false;
  try {
    const { exp } = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { exp?: unknown };
    return typeof exp === "number" && exp > now.getTime();
  } catch {
    return false;
  }
}

/** Compares in constant time. Returns false if no admin password is configured. */
export function verifyPassword(input: string, env: AuthEnv): boolean {
  const expected = env.ADMIN_PASSWORD;
  if (!expected || !input) return false;
  // Hash both sides so length differences do not leak through timing.
  return safeEqual(sign(input, "pw"), sign(expected, "pw"));
}

export function isAdminConfigured(env: AuthEnv): boolean {
  return Boolean(env.ADMIN_PASSWORD) && (env.SESSION_SECRET?.length ?? 0) >= MIN_SECRET_LENGTH;
}

/** The single gate in front of every data-changing operation. */
export function checkAdmin(token: string | undefined, env: AuthEnv, now = new Date()): AdminCheck {
  if (!env.ADMIN_PASSWORD) {
    return { ok: false, status: 403, code: "DEMO_READ_ONLY", message: "Read-only demo: no admin password is configured, so changes are disabled." };
  }
  if ((env.SESSION_SECRET?.length ?? 0) < MIN_SECRET_LENGTH) {
    return { ok: false, status: 403, code: "NOT_CONFIGURED", message: `SESSION_SECRET must be at least ${MIN_SECRET_LENGTH} characters.` };
  }
  if (!verifySessionToken(token, env.SESSION_SECRET as string, now)) {
    return { ok: false, status: 401, code: "UNAUTHENTICATED", message: "Sign in as the planner to make changes." };
  }
  return { ok: true };
}
