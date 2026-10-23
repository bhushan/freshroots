import { describe, expect, it } from "vitest";
import { checkAdmin, createSessionToken, verifyPassword, verifySessionToken, type AuthEnv } from "@/lib/auth/session";

const SECRET = "x".repeat(40);
const env: AuthEnv = { ADMIN_PASSWORD: "correct horse", SESSION_SECRET: SECRET };
const NOW = new Date("2026-10-23T10:00:00Z");

describe("session tokens", () => {
  it("round-trips a valid token", () => {
    const token = createSessionToken(SECRET, NOW);
    expect(verifySessionToken(token, SECRET, NOW)).toBe(true);
  });

  it("expires after eight hours", () => {
    const token = createSessionToken(SECRET, NOW);
    expect(verifySessionToken(token, SECRET, new Date(NOW.getTime() + 7.9 * 3600_000))).toBe(true);
    expect(verifySessionToken(token, SECRET, new Date(NOW.getTime() + 8.1 * 3600_000))).toBe(false);
  });

  it("rejects a tampered payload or signature", () => {
    const token = createSessionToken(SECRET, NOW);
    const [payload, sig] = token.split(".");
    const forgedPayload = Buffer.from(JSON.stringify({ exp: NOW.getTime() + 999_999_999 })).toString("base64url");
    expect(verifySessionToken(`${forgedPayload}.${sig}`, SECRET, NOW)).toBe(false);
    expect(verifySessionToken(`${payload}.${sig.slice(0, -2)}AA`, SECRET, NOW)).toBe(false);
  });

  it("rejects a token signed with a different secret and malformed input", () => {
    const token = createSessionToken("y".repeat(40), NOW);
    expect(verifySessionToken(token, SECRET, NOW)).toBe(false);
    for (const bad of ["", "abc", "a.b.c", "..", undefined]) {
      expect(verifySessionToken(bad as string, SECRET, NOW), String(bad)).toBe(false);
    }
  });
});

describe("verifyPassword", () => {
  it("accepts only the configured password", () => {
    expect(verifyPassword("correct horse", env)).toBe(true);
    expect(verifyPassword("correct horsf", env)).toBe(false);
    expect(verifyPassword("", env)).toBe(false);
    expect(verifyPassword("correct horse and more", env)).toBe(false);
  });

  it("never accepts anything when no password is configured", () => {
    expect(verifyPassword("", {})).toBe(false);
    expect(verifyPassword("anything", { SESSION_SECRET: SECRET })).toBe(false);
  });
});

describe("checkAdmin (the gate in front of every mutation)", () => {
  it("is read-only demo mode when ADMIN_PASSWORD is not set", () => {
    expect(checkAdmin(undefined, { SESSION_SECRET: SECRET }, NOW)).toMatchObject({ ok: false, status: 403, code: "DEMO_READ_ONLY" });
    // even a validly signed token cannot unlock a deployment without a password
    expect(checkAdmin(createSessionToken(SECRET, NOW), { SESSION_SECRET: SECRET }, NOW)).toMatchObject({ ok: false, status: 403 });
  });

  it("refuses when the session secret is missing or weak", () => {
    expect(checkAdmin("t", { ADMIN_PASSWORD: "p" }, NOW)).toMatchObject({ ok: false, status: 403, code: "NOT_CONFIGURED" });
    expect(checkAdmin("t", { ADMIN_PASSWORD: "p", SESSION_SECRET: "short" }, NOW)).toMatchObject({ ok: false, status: 403, code: "NOT_CONFIGURED" });
  });

  it("requires a valid session cookie once configured", () => {
    expect(checkAdmin(undefined, env, NOW)).toMatchObject({ ok: false, status: 401, code: "UNAUTHENTICATED" });
    expect(checkAdmin("garbage", env, NOW)).toMatchObject({ ok: false, status: 401 });
    expect(checkAdmin(createSessionToken(SECRET, NOW), env, NOW)).toEqual({ ok: true });
  });
});
