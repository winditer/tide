"use client";

import { Suspense, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { setAuthTokens } from "@tide/core";

/**
 * Lark OAuth callback receiver.
 *
 * The backend `/api/auth/lark/callback` handler 302-redirects here with
 * `?token=…&refresh_token=…` once the OIDC exchange succeeds. We pull the
 * tokens out of the URL, persist them into the Zustand auth store, then
 * forward to the originally-requested page (or home).
 *
 * Lives under `/auth/*` so the global auth-guard doesn't intercept it before
 * the tokens have been written.
 */
function CallbackInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const consumedRef = useRef(false);

  useEffect(() => {
    if (consumedRef.current) return;
    consumedRef.current = true;

    const token = searchParams?.get("token");
    const refreshToken = searchParams?.get("refresh_token");
    const redirectTo = searchParams?.get("redirect") || "/";

    if (token && refreshToken) {
      setAuthTokens({ accessToken: token, refreshToken });
      router.replace(redirectTo);
    } else {
      router.replace("/auth/login?auth_error=missing_token");
    }
  }, [router, searchParams]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background text-foreground">
      <div className="flex flex-col items-center gap-3 text-sm text-muted-foreground">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-current border-t-transparent" />
        <span>正在完成登录…</span>
      </div>
    </div>
  );
}

export default function CallbackPage() {
  return (
    <Suspense fallback={null}>
      <CallbackInner />
    </Suspense>
  );
}
