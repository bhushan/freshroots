import "server-only";
import { cookies } from "next/headers";
import { checkAdmin, SESSION_COOKIE, type AuthEnv } from "@/lib/auth/session";

export function authEnv(): AuthEnv {
  return { ADMIN_PASSWORD: process.env.ADMIN_PASSWORD, SESSION_SECRET: process.env.SESSION_SECRET };
}

export async function sessionToken(): Promise<string | undefined> {
  return (await cookies()).get(SESSION_COOKIE)?.value;
}

export type AccessMode = "demo" | "signed-out" | "admin" | "misconfigured";

/** What the current visitor may do, for rendering controls. The API enforces it independently. */
export async function getAccessMode(): Promise<AccessMode> {
  const check = checkAdmin(await sessionToken(), authEnv());
  if (check.ok) return "admin";
  if (check.code === "DEMO_READ_ONLY") return "demo";
  if (check.code === "NOT_CONFIGURED") return "misconfigured";
  return "signed-out";
}
