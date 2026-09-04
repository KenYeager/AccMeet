"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import CalendarStatus from "@/components/CalendarStatus";
import EventForm from "@/components/EventForm";

function HomeContent() {
  const searchParams = useSearchParams();
  const [connected, setConnected] = useState(false);
  const [banner, setBanner] = useState<{ type: "success" | "error"; msg: string } | null>(null);

  useEffect(() => {
    const justConnected = searchParams.get("connected");
    const errorParam    = searchParams.get("error");

    if (justConnected === "true") {
      setBanner({ type: "success", msg: "Google Calendar connected successfully!" });
      // Clean up query param without a full reload
      window.history.replaceState({}, "", "/");
    } else if (errorParam) {
      setBanner({ type: "error", msg: `Connection failed: ${errorParam}` });
      window.history.replaceState({}, "", "/");
    }
  }, [searchParams]);

  return (
    <div className="page-wrapper">
      <header className="page-header">
        <div className="page-logo">
          <span className="page-logo-dot" />
          AccMeet
        </div>
        <h1 className="page-title">Calendar Integration</h1>
        <p className="page-subtitle">
          Connect once, schedule events from your meetings instantly.
        </p>
      </header>

      <main className="main-content" role="main">
        {/* Post-OAuth banner */}
        {banner && (
          <div
            className={`alert ${banner.type === "success" ? "alert-success" : "alert-error"}`}
            role="alert"
          >
            <span className="alert-icon">
              {banner.type === "success" ? "✓" : "⚠"}
            </span>
            <span>{banner.msg}</span>
          </div>
        )}

        {/* Google Calendar connection status */}
        <CalendarStatus onStatusChange={setConnected} />

        {/* Event creation form */}
        <EventForm connected={connected} />
      </main>
    </div>
  );
}

export default function Home() {
  return (
    <Suspense>
      <HomeContent />
    </Suspense>
  );
}
