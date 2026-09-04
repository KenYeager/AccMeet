"use client";

import { useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";

/**
 * OAuth Callback Page
 *
 * Google redirects here with ?code=... after user authorizes.
 * BUT — since we configured GOOGLE_REDIRECT_URI to point directly to the
 * FastAPI backend (/api/calendar/callback), Google will NOT land here normally.
 *
 * This page is a fallback for configurations where the redirect URI points
 * to the frontend (e.g. http://localhost:3000/callback). In that case this
 * page forwards the code to the backend for token exchange.
 *
 * In the default configuration, FastAPI handles the callback directly and
 * redirects the browser back to http://localhost:3000?connected=true.
 */

function CallbackContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const code  = searchParams.get("code");
    const error = searchParams.get("error");

    if (error) {
      router.replace(`/?error=${encodeURIComponent(error)}`);
      return;
    }

    if (!code) {
      router.replace("/");
      return;
    }

    // If this page is reached, forward the code to the backend ourselves.
    // This handles the case where the redirect URI is set to this page's URL.
    const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
    window.location.href = `${apiUrl}/api/calendar/callback?code=${encodeURIComponent(code)}`;
  }, [router, searchParams]);

  return (
    <div className="callback-page">
      <div className="callback-card">
        <div className="callback-icon" aria-hidden="true">🔐</div>
        <h1 className="callback-title">Connecting…</h1>
        <p className="callback-subtitle">
          Completing Google Calendar authorization. You will be redirected
          back in a moment.
        </p>
        <br />
        <span
          className="spinner"
          style={{ margin: "0 auto", borderTopColor: "var(--accent)" }}
          aria-label="Loading"
        />
      </div>
    </div>
  );
}

export default function CallbackPage() {
  return (
    <Suspense>
      <CallbackContent />
    </Suspense>
  );
}
