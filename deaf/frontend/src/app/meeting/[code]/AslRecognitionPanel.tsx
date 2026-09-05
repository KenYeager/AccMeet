"use client";

import { useEffect, useRef } from "react";
import { Hand, Loader2, Trash2 } from "lucide-react";
import type { AslRecognitionEntry } from "@/types";

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function ConfidenceDots({ confidence }: { confidence: number }) {
  const filled = Math.round(confidence * 5);
  return (
    <span style={{ display: "flex", gap: "2px", alignItems: "center" }}>
      {[1, 2, 3, 4, 5].map(i => (
        <span
          key={i}
          style={{
            width: "6px",
            height: "6px",
            borderRadius: "50%",
            background: i <= filled ? "var(--color-success)" : "rgba(255,255,255,0.15)",
          }}
        />
      ))}
    </span>
  );
}

export function AslRecognitionPanel({
  entries,
  isDetecting,
  lastSign,
  onClear,
}: {
  entries: AslRecognitionEntry[];
  isDetecting: boolean;
  lastSign: string | null;
  onClear: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries]);

  return (
    <div style={{
      height: "100%",
      display: "flex",
      flexDirection: "column",
      background: "linear-gradient(180deg, rgba(6,17,40,0.98) 0%, rgba(4,12,28,0.99) 100%)",
      backdropFilter: "blur(20px)",
      boxShadow: "-4px 0 32px rgba(0,0,0,0.4)",
    }}>
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0.75rem 1rem",
        borderBottom: "1px solid rgba(34, 197, 94, 0.15)",
        background: "rgba(10, 20, 40, 0.9)",
        flexShrink: 0,
      }}>
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          color: "var(--color-success)",
          fontWeight: 800,
          fontSize: "0.875rem",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
        }}>
          <Hand size={15} />
          ASL to English
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <div style={{
            display: "flex",
            alignItems: "center",
            gap: "0.375rem",
            fontSize: "0.75rem",
            color: isDetecting ? "var(--color-success)" : "var(--color-text-muted)",
          }}>
            <span style={{
              width: "8px", height: "8px", borderRadius: "50%",
              background: isDetecting ? "var(--color-success)" : "rgba(255,255,255,0.2)",
              boxShadow: isDetecting ? "0 0 8px rgba(34,197,94,0.8)" : "none",
            }} />
            {isDetecting ? "Detecting" : "Watching"}
          </div>
          {entries.length > 0 && (
            <button onClick={onClear} className="btn btn-ghost"
              style={{ padding: "0.25rem 0.5rem", fontSize: "0.75rem", gap: "0.25rem", color: "var(--color-text-muted)" }}
              title="Clear history">
              <Trash2 size={12} />
            </button>
          )}
        </div>
      </div>

      <div style={{ flexShrink: 0, padding: "1rem", borderBottom: "1px solid rgba(34, 197, 94, 0.1)" }}>
        <div style={{
          width: "100%", minHeight: "120px", borderRadius: "1rem",
          background: lastSign
            ? "linear-gradient(135deg, rgba(34,197,94,0.15), rgba(16,185,129,0.08))"
            : "rgba(6, 11, 24, 0.6)",
          border: lastSign ? "2px solid rgba(34, 197, 94, 0.4)" : "2px dashed rgba(255,255,255,0.1)",
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          gap: "0.5rem", padding: "1rem",
          boxShadow: lastSign ? "0 0 30px rgba(34,197,94,0.15)" : "none",
          transition: "all 0.3s ease",
        }}>
          {lastSign ? (
            <>
              <span style={{ fontSize: "2.25rem", fontWeight: 900, color: "var(--color-success)", letterSpacing: "0.05em" }}>
                {lastSign}
              </span>
              <span style={{ fontSize: "0.75rem", color: "var(--color-text-muted)", fontWeight: 500 }}>
                Last recognized sign
              </span>
            </>
          ) : isDetecting ? (
            <>
              <Loader2 size={28} style={{ color: "var(--color-success)", opacity: 0.7 }} />
              <span style={{ fontSize: "0.875rem", color: "var(--color-text-secondary)" }}>Analyzing hand signs...</span>
            </>
          ) : (
            <>
              <Hand size={36} style={{ color: "rgba(255,255,255,0.2)" }} />
              <span style={{ fontSize: "0.875rem", color: "var(--color-text-secondary)", textAlign: "center", maxWidth: "200px" }}>
                Waiting for sign language from Deaf participant
              </span>
            </>
          )}
        </div>
      </div>

      <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: "0.75rem", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
        {entries.length === 0 ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: "0.5rem", color: "var(--color-text-muted)", fontSize: "0.8125rem", textAlign: "center", padding: "1rem" }}>
            <p>Sign recognition history will appear here</p>
          </div>
        ) : (
          [...entries].reverse().map(entry => (
            <div key={entry.id} style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "0.5rem 0.75rem", borderRadius: "0.625rem",
              background: "rgba(15, 25, 50, 0.7)", border: "1px solid rgba(34, 197, 94, 0.12)", gap: "0.5rem",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <span style={{ fontWeight: 800, fontSize: "0.9375rem", color: "var(--color-success)", letterSpacing: "0.04em" }}>
                  {entry.word}
                </span>
                <ConfidenceDots confidence={entry.confidence} />
              </div>
              <span style={{ fontSize: "0.6875rem", color: "var(--color-text-muted)", whiteSpace: "nowrap" }}>
                {formatTime(entry.timestamp)}
              </span>
            </div>
          ))
        )}
      </div>

      <div style={{
        flexShrink: 0, padding: "0.625rem 1rem",
        borderTop: "1px solid rgba(34, 197, 94, 0.1)",
        background: "rgba(6, 11, 24, 0.95)",
        fontSize: "0.75rem", color: "var(--color-text-muted)", textAlign: "center",
      }}>
        {entries.length} sign{entries.length !== 1 ? "s" : ""} recognized via MediaPipe Hands
      </div>
    </div>
  );
}