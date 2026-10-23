import { loginHandler } from "@/lib/api/handlers";
import { SESSION_COOKIE, SESSION_TTL_MS } from "@/lib/auth/session";
import { authEnv } from "@/lib/server/context";
import { guarded, readJson, respond } from "@/lib/server/http";

export const runtime = "nodejs";

export async function POST(req: Request) {
  return guarded(async () => {
    const result = await loginHandler({ env: authEnv(), rawBody: await readJson(req) });
    const res = respond(result);
    if (result.sessionToken) {
      res.cookies.set(SESSION_COOKIE, result.sessionToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: SESSION_TTL_MS / 1000,
      });
    }
    return res;
  });
}
