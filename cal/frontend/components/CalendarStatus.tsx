"use client";

import { useEffect, useState } from "react";
import { fetchStatus, fetchAuthUrl, disconnectCalendar } from "@/lib/api";

interface Props {
  onStatusChange: (connected: boolean) => void;
}

export default function CalendarStatus({ onStatusChange }: Props) {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);

  const checkStatus = async () => {
    try {
      const data = await fetchStatus();
      setConnected(data.connected);
      onStatusChange(data.connected);
    } catch {
      setConnected(false);
      onStatusChange(false);
    }
  };

  useEffect(() => {
    checkStatus();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleConnect = async () => {
    setLoading(true);
    try {
      const data = await fetchAuthUrl();
      // Redirect browser to Google OAuth consent screen
      window.location.href = data.auth_url;
    } catch {
      setLoading(false);
    }
  };

  const handleDisconnect = async () => {
    setLoading(true);
    try {
      await disconnectCalendar();
      setConnected(false);
      onStatusChange(false);
    } finally {
      setLoading(false);
    }
  };

  const isLoading = connected === null;

  return (
    <div className="card">
      <p className="card-title">Google Calendar</p>

      <div className="status-row">
        <div className="status-info">
          <div
            className={`status-icon ${connected ? "connected" : "disconnected"}`}
            aria-hidden="true"
          >
            {isLoading ? "⏳" : connected ? "📅" : "🔌"}
          </div>
          <div>
            <div
              className={`status-label ${connected ? "connected" : "disconnected"}`}
            >
              {isLoading
                ? "Checking…"
                : connected
                ? "Connected ✓"
                : "Not Connected"}
            </div>
            <div className="status-sublabel">
              {isLoading
                ? ""
                : connected
                ? "Ready to create events"
                : "Connect to add events to your calendar"}
            </div>
          </div>
        </div>

        {!isLoading && (
          <div style={{ display: "flex", gap: "0.5rem" }}>
            {connected ? (
              <button
                id="disconnect-btn"
                className="btn btn-danger"
                onClick={handleDisconnect}
                disabled={loading}
                aria-label="Disconnect Google Calendar"
              >
                {loading ? <span className="spinner" /> : "Disconnect"}
              </button>
            ) : (
              <button
                id="connect-btn"
                className="btn btn-primary"
                onClick={handleConnect}
                disabled={loading}
                aria-label="Connect Google Calendar"
              >
                {loading ? (
                  <>
                    <span className="spinner" />
                    Redirecting…
                  </>
                ) : (
                  <>🔗 Connect Google Calendar</>
                )}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
