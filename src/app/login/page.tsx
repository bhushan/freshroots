import Link from "next/link";
import { LoginForm } from "@/components/login-form";
import { getAccessMode } from "@/lib/server/context";

export const metadata = { title: "Sign in" };

export default async function LoginPage() {
  const mode = await getAccessMode();
  return (
    <div className="mx-auto mt-6 max-w-md space-y-8 md:mt-16">
      <div>
        <p className="type-label text-ash">Planner access</p>
        <h1 className="type-title mt-3">Sign in</h1>
        <p className="mt-3 text-base text-ash">Signing in lets you approve or override recommendations, re-run the analysis and request AI commentary. There is no registration.</p>
      </div>
      <div className="rounded-lg border border-border bg-card p-6">
        {mode === "demo" ? (
          <p className="text-sm text-ash">This deployment is a read-only demo because no admin password is configured.</p>
        ) : mode === "misconfigured" ? (
          <p className="text-sm text-ash">Sign-in is unavailable: the session secret is missing or shorter than 32 characters.</p>
        ) : mode === "admin" ? (
          <p className="text-sm text-ash">
            You are signed in.{" "}
            <Link href="/review" className="font-medium text-snow underline decoration-graphite underline-offset-4 hover:decoration-snow">
              Open the review queue
            </Link>
          </p>
        ) : (
          <LoginForm />
        )}
      </div>
    </div>
  );
}
