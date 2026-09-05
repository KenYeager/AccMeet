"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Copy,
  Crown,
  Hand,
  Loader2,
  Mic,
  MicOff,
  PhoneOff,
  RefreshCw,
  Send,
  Users,
  Video,
  VideoOff,
  Captions,
  Sparkles,
} from "lucide-react";
import toast from "react-hot-toast";
import { useIdentity } from "@/hooks/useIdentity";
import { useWebRTC } from "@/hooks/useWebRTC";
import { useSpeakingDetection } from "@/hooks/useSpeakingDetection";
import { meetings, ApiError } from "@/lib/api";
import type { ConnectionStatus, RemoteParticipant, CaptionEntry } from "@/types";
import type { LocalCaptionEntry } from "@/hooks/useWebRTC";
import type { CaptionerStatus } from "@/lib/liveCaptioner";

function getInitials(name: string) {
  return name ? name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2) : "?";
}

function formatTime(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60).toString().padStart(2, "0");
  const s = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function statusDotClass(status: ConnectionStatus) {
  if (status === "connected") return "status-dot status-dot-green";
  if (status === "error") return "status-dot status-dot-red";
  return "status-dot status-dot-yellow";
}

function statusLabel(status: ConnectionStatus) {
  switch (status) {
    case "connected": return "Connected";
    case "connecting": return "Connecting…";
    case "disconnected": return "Reconnecting…";
    case "error": return "Connection error";
  }
}

type JoinState =
  | { phase: "checking" }
  | { phase: "ready"; hostId: string }
  | { phase: "error"; title: string; message: string };

// ---------- Video tile ----------
function ParticipantTile({
  name,
  isMuted,
  isCameraOff,
  isSpeaking,
  isHost,
  isSelf,
  stream,
  currentCaption,
}: {
  name: string;
  isMuted: boolean;
  isCameraOff: boolean;
  isSpeaking: boolean;
  isHost: boolean;
  isSelf: boolean;
  stream?: MediaStream | null;
  currentCaption?: string;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream ?? null;
  }, [stream]);

  const showVideo = !!stream?.getVideoTracks().length && !isCameraOff;

  return (
    <div
      className={`participant-card ${isSpeaking && !isMuted ? "speaking-ring" : ""}`}
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        minHeight: "180px",
        borderRadius: "0.875rem",
        overflow: "hidden",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--color-navy-800)",
        border: "1px solid var(--color-border)",
      }}
    >
      {stream && (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={isSelf}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            transform: isSelf ? "scaleX(-1)" : undefined,
            display: showVideo ? "block" : "none",
          }}
        />
      )}

      {!showVideo && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.75rem", padding: "1rem" }}>
          <div style={{ position: "relative" }}>
            <div className="avatar avatar-lg">{getInitials(name)}</div>
            <div
              style={{
                position: "absolute", bottom: -2, right: -2,
                width: "1.5rem", height: "1.5rem", borderRadius: "50%",
                display: "flex", alignItems: "center", justifyContent: "center",
                background: isMuted ? "var(--color-danger)" : "var(--color-navy-800)",
                border: "2px solid var(--color-navy-950)",
                color: isMuted ? "white" : "var(--color-success)",
              }}
            >
              {isMuted ? <MicOff size={11} /> : <Mic size={11} />}
            </div>
          </div>
          <div style={{
            fontWeight: 700, fontSize: "0.9375rem", display: "flex", alignItems: "center",
            gap: "0.375rem", color: "var(--color-text-primary)",
          }}>
            {name} {isSelf && <span style={{ color: "var(--color-text-muted)", fontWeight: 400 }}>(you)</span>}
            {isHost && <Crown size={13} color="var(--color-warning)" />}
          </div>
        </div>
      )}

      {/* Name tag overlay when video is on */}
      {showVideo && (
        <div style={{
          position: "absolute", left: 0, right: 0, bottom: 0,
          padding: "0.5rem 0.75rem",
          background: "linear-gradient(transparent, rgba(6,11,24,0.85))",
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <span style={{ fontWeight: 700, fontSize: "0.875rem", display: "flex", alignItems: "center", gap: "0.375rem" }}>
            {name} {isSelf && <span style={{ color: "var(--color-text-muted)", fontWeight: 400, fontSize: "0.8125rem" }}>(you)</span>}
            {isHost && <Crown size={12} color="var(--color-warning)" />}
          </span>
          <span style={{ color: isMuted ? "var(--color-danger)" : "var(--color-success)", display: "flex" }}>
            {isMuted ? <MicOff size={14} /> : <Mic size={14} />}
          </span>
        </div>
      )}

      {/* Floating live caption overlay directly on tile */}
      {currentCaption && (
        <div style={{
          position: "absolute", bottom: showVideo ? "2.5rem" : "0.75rem", left: "0.5rem", right: "0.5rem",
          background: "rgba(0, 0, 0, 0.85)",
          backdropFilter: "blur(8px)",
          borderLeft: "3px solid var(--color-caption)",
          borderRadius: "0.5rem",
          padding: "0.4rem 0.625rem",
          fontSize: "0.875rem",
          color: "var(--color-caption)",
          fontWeight: 700,
          lineHeight: 1.35,
          zIndex: 5,
        }}>
          💬 {currentCaption}
        </div>
      )}
    </div>
  );
}

// ---------- Caption history panel ----------
function CaptionPanel({
  participants,
  localUserName,
  localCaption,
  localHistory,
  captionStatus,
  onRestartCaptions,
  onSendManualCaption,
}: {
  participants: RemoteParticipant[];
  localUserName: string;
  localCaption: string;
  localHistory: LocalCaptionEntry[];
  captionStatus: CaptionerStatus;
  onRestartCaptions: () => void;
  onSendManualCaption: (text: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [manualText, setManualText] = useState("");

  // Merge all history entries and sort by timestamp
  const allEntries: Array<{ name: string; entry: CaptionEntry | LocalCaptionEntry; isSelf: boolean }> = [];

  // Local history
  localHistory.forEach(e => allEntries.push({ name: localUserName, entry: e, isSelf: true }));

  // Remote history
  participants.forEach(p => {
    (p.captionHistory || []).forEach(e => allEntries.push({ name: p.user_name, entry: e, isSelf: false }));
  });

  allEntries.sort((a, b) => a.entry.timestamp - b.entry.timestamp);

  // Auto-scroll to bottom on new entries
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [allEntries.length, localCaption]);

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualText.trim()) return;
    onSendManualCaption(manualText.trim());
    setManualText("");
  };

  const hasAnyCaption = allEntries.length > 0 || localCaption || participants.some(p => p.caption);

  return (
    <div className="caption-panel" style={{
      height: "100%", display: "flex", flexDirection: "column",
      background: "var(--color-caption-bg)",
      borderTop: "2px solid rgba(255, 224, 51, 0.3)",
      backdropFilter: "blur(20px)",
      boxShadow: "var(--shadow-caption)",
    }}>
      {/* Panel header */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0.5rem 1.25rem",
        borderBottom: "1px solid rgba(255, 224, 51, 0.12)",
        background: "rgba(10, 16, 32, 0.8)",
        flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.625rem" }}>
          <div style={{
            display: "flex", alignItems: "center", gap: "0.375rem",
            color: "var(--color-caption)", fontWeight: 800, fontSize: "0.875rem",
            textTransform: "uppercase", letterSpacing: "0.06em",
          }}>
            <Sparkles size={15} /> Live Transcripts & Captions
          </div>

          <div style={{
            display: "inline-flex", alignItems: "center", gap: "0.375rem",
            background: captionStatus === "active" ? "rgba(34, 197, 94, 0.12)" : captionStatus === "error" ? "rgba(239, 68, 68, 0.12)" : "rgba(245, 158, 11, 0.12)",
            border: `1px solid ${captionStatus === "active" ? "rgba(34, 197, 94, 0.3)" : captionStatus === "error" ? "rgba(239, 68, 68, 0.3)" : "rgba(245, 158, 11, 0.3)"}`,
            borderRadius: "1rem", padding: "0.15rem 0.6rem", fontSize: "0.75rem", fontWeight: 600,
            color: captionStatus === "active" ? "var(--color-success)" : captionStatus === "error" ? "var(--color-danger)" : "var(--color-warning)",
          }}>
            <span style={{
              width: "0.4rem", height: "0.4rem", borderRadius: "50%",
              background: captionStatus === "active" ? "var(--color-success)" : captionStatus === "error" ? "var(--color-danger)" : "var(--color-warning)",
              display: "inline-block",
            }} />
            {captionStatus === "active" ? "Listening" : captionStatus === "starting" ? "Starting..." : captionStatus === "error" ? "Mic Error" : "Idle"}
          </div>
        </div>

        <button
          onClick={onRestartCaptions}
          className="btn btn-ghost"
          style={{ padding: "0.25rem 0.625rem", fontSize: "0.75rem", gap: "0.375rem" }}
          title="Restart speech recognition"
        >
          <RefreshCw size={13} /> Restart Mic Captions
        </button>
      </div>

      {/* History scroll area */}
      <div
        className="caption-history"
        ref={scrollRef}
        style={{ flex: 1, overflowY: "auto", padding: "0.5rem 1.25rem", minHeight: 0 }}
      >
        {!hasAnyCaption && (
          <div style={{
            textAlign: "center", color: "var(--color-text-muted)",
            fontSize: "0.875rem", padding: "1rem",
            display: "flex", flexDirection: "column", alignItems: "center", gap: "0.5rem",
          }}>
            <Captions size={24} color="var(--color-caption)" style={{ opacity: 0.7 }} />
            <p style={{ color: "var(--color-caption)", fontWeight: 600 }}>Captions appear automatically as speech is recognized</p>
            <p style={{ fontSize: "0.8125rem", color: "var(--color-text-secondary)" }}>
              Speak into your microphone or type a text caption below to broadcast to everyone.
            </p>
          </div>
        )}

        {allEntries.map((item, idx) => (
          <div key={`${item.entry.id}-${idx}`} className="caption-entry-row" style={{ padding: "0.4rem 0" }}>
            <span className="caption-speaker" style={{
              color: item.isSelf ? "var(--color-blue-400)" : "var(--color-caption)",
            }}>
              {item.name}{item.isSelf ? " (you)" : ""}
              <span style={{
                fontWeight: 400, color: "var(--color-text-muted)",
                marginLeft: "0.5rem", textTransform: "none", letterSpacing: 0, fontSize: "0.75rem",
              }}>
                {formatTime(item.entry.timestamp)}
              </span>
            </span>
            <p className={`caption-text-live ${item.entry.isFinal ? "caption-text-final" : "caption-text-interim"}`}
              style={{ fontSize: "1.1rem", marginTop: "0.1rem", color: item.entry.isFinal ? "var(--color-caption)" : "rgba(255, 224, 51, 0.7)" }}>
              {item.entry.text}
            </p>
          </div>
        ))}

        {/* Current live lines at bottom */}
        {localCaption && (
          <div className="caption-entry-row caption-live-bar" style={{ margin: "0.375rem 0", padding: "0.4rem 0.625rem" }}>
            <span className="caption-speaker" style={{ color: "var(--color-blue-400)" }}>
              {localUserName} (you) · speaking live
            </span>
            <p className="caption-text-live" style={{ color: "var(--color-caption)", fontSize: "1.15rem", fontWeight: 700 }}>
              {localCaption}
            </p>
          </div>
        )}

        {participants.filter(p => p.caption).map(p => (
          <div key={`live-${p.user_id}`} className="caption-entry-row caption-live-bar" style={{ margin: "0.375rem 0", padding: "0.4rem 0.625rem" }}>
            <span className="caption-speaker" style={{ color: "var(--color-caption)" }}>
              {p.user_name} · speaking live
            </span>
            <p className="caption-text-live" style={{ color: "var(--color-caption)", fontSize: "1.15rem", fontWeight: 700 }}>
              {p.caption}
            </p>
          </div>
        ))}
      </div>

      {/* Manual text caption input bar for non-verbal users or testing */}
      <form onSubmit={handleManualSubmit} style={{
        padding: "0.5rem 1rem",
        borderTop: "1px solid rgba(255, 224, 51, 0.12)",
        background: "rgba(6, 11, 24, 0.9)",
        display: "flex",
        gap: "0.5rem",
        alignItems: "center",
        flexShrink: 0,
      }}>
        <input
          type="text"
          className="input"
          placeholder="Type live text caption..."
          value={manualText}
          onChange={e => setManualText(e.target.value)}
          style={{
            flex: 1,
            padding: "0.4rem 0.75rem",
            fontSize: "0.875rem",
            height: "2.25rem",
            background: "rgba(15, 26, 48, 0.9)",
            borderColor: "rgba(255, 224, 51, 0.2)",
            color: "var(--color-caption)",
          }}
        />
        <button
          type="submit"
          className="btn btn-primary"
          style={{
            padding: "0.4rem 0.875rem",
            height: "2.25rem",
            fontSize: "0.8125rem",
            background: "linear-gradient(135deg, #ffd000, #f59e0b)",
            color: "#060b18",
            fontWeight: 700,
          }}
        >
          <Send size={13} /> Caption
        </button>
      </form>
    </div>
  );
}

// ---------- Main page ----------
export default function MeetingRoomPage() {
  const params = useParams<{ code: string }>();
  const meetingCode = (params.code || "").toUpperCase();
  const router = useRouter();
  const { userId, userName, setUserName, isReady } = useIdentity();

  const [joinState, setJoinState] = useState<JoinState>({ phase: "checking" });
  const [elapsed, setElapsed] = useState(0);
  const [codeCopied, setCodeCopied] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const joinedAtRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isReady || !userName || !meetingCode) return;
    let cancelled = false;

    (async () => {
      try {
        const details = await meetings.get(meetingCode);
        if (details.meeting.status === "ended") {
          if (!cancelled) setJoinState({ phase: "error", title: "Meeting has ended", message: "This meeting is no longer active." });
          return;
        }
        await meetings.join(meetingCode, { user_id: userId, user_name: userName });
        if (!cancelled) {
          joinedAtRef.current = Date.now();
          setJoinState({ phase: "ready", hostId: details.meeting.host_id });
        }
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) {
          setJoinState({ phase: "error", title: "Meeting doesn't exist", message: "Double-check the meeting code and try again." });
          return;
        }
        const message = err instanceof ApiError ? err.message : "Something went wrong joining this meeting.";
        setJoinState({ phase: "error", title: "Can't join meeting", message });
      }
    })();

    return () => { cancelled = true; };
  }, [isReady, userId, userName, meetingCode]);

  const webrtcUserId = joinState.phase === "ready" ? userId : undefined;
  const webrtcUserName = joinState.phase === "ready" ? userName : undefined;

  const {
    localStream,
    participants,
    isMuted,
    isCameraOff,
    hasCamera,
    connectionStatus,
    micError,
    localCaption,
    localCaptionHistory,
    captionStatus,
    toggleMute,
    toggleCamera,
    leaveRoom,
    restartCaptions,
    sendManualCaption,
  } = useWebRTC(meetingCode, webrtcUserId, webrtcUserName);

  useEffect(() => {
    if (joinState.phase !== "ready") return;
    const interval = setInterval(() => {
      if (joinedAtRef.current) setElapsed(Math.floor((Date.now() - joinedAtRef.current) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [joinState.phase]);

  const localSpeaking = useSpeakingDetection(isMuted ? null : localStream);

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(meetingCode);
      setCodeCopied(true);
      setTimeout(() => setCodeCopied(false), 1500);
    } catch {
      toast.error("Couldn't copy — copy it manually.");
    }
  };

  // ---------- Gates ----------
  if (!isReady) {
    return <div className="page-center"><Loader2 size={28} className="animate-spin" color="var(--color-blue-400)" /></div>;
  }

  if (!userName) {
    const handleSubmitName = (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = nameInput.trim();
      if (!trimmed) { toast.error("Enter a name to continue"); return; }
      setUserName(trimmed);
    };
    return (
      <div className="page-center">
        <div className="glass-card fade-in container-sm" style={{ padding: "2.5rem" }}>
          <h1 style={{ fontSize: "1.25rem", fontWeight: 700, marginBottom: "0.5rem" }}>Join meeting {meetingCode}</h1>
          <p style={{ color: "var(--color-text-secondary)", fontSize: "0.9375rem", marginBottom: "1.5rem" }}>
            Enter your name to continue.
          </p>
          <form onSubmit={handleSubmitName} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <input autoFocus type="text" className="input" placeholder="e.g. Alex Johnson"
              value={nameInput} onChange={e => setNameInput(e.target.value)} maxLength={50} />
            <button type="submit" className="btn btn-primary" style={{ padding: "0.75rem" }}>Continue</button>
          </form>
        </div>
      </div>
    );
  }

  if (joinState.phase === "checking") {
    return (
      <div className="page-center">
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "1rem" }}>
          <Loader2 size={28} className="animate-spin" color="var(--color-blue-400)" />
          <p style={{ color: "var(--color-text-secondary)" }}>Joining meeting…</p>
        </div>
      </div>
    );
  }

  if (joinState.phase === "error") {
    return (
      <div className="page-center">
        <div className="glass-card fade-in container-sm" style={{ padding: "2.5rem", textAlign: "center" }}>
          <div style={{
            width: "3.5rem", height: "3.5rem", borderRadius: "50%",
            background: "rgba(239,68,68,0.12)", display: "flex", alignItems: "center",
            justifyContent: "center", margin: "0 auto 1.25rem", color: "var(--color-danger)",
          }}>
            <AlertTriangle size={24} />
          </div>
          <h1 style={{ fontSize: "1.25rem", fontWeight: 700, marginBottom: "0.5rem" }}>{joinState.title}</h1>
          <p style={{ color: "var(--color-text-secondary)", fontSize: "0.9375rem", marginBottom: "1.75rem" }}>{joinState.message}</p>
          <Link href="/dashboard" className="btn btn-primary" style={{ padding: "0.75rem 1.5rem" }}>
            <ArrowLeft size={16} /> Back to dashboard
          </Link>
        </div>
      </div>
    );
  }

  if (micError) {
    return (
      <div className="page-center">
        <div className="glass-card fade-in container-sm" style={{ padding: "2.5rem", textAlign: "center" }}>
          <div style={{
            width: "3.5rem", height: "3.5rem", borderRadius: "50%",
            background: "rgba(245,158,11,0.12)", display: "flex", alignItems: "center",
            justifyContent: "center", margin: "0 auto 1.25rem", color: "var(--color-warning)",
          }}>
            <MicOff size={24} />
          </div>
          <h1 style={{ fontSize: "1.25rem", fontWeight: 700, marginBottom: "0.5rem" }}>Microphone unavailable</h1>
          <p style={{ color: "var(--color-text-secondary)", fontSize: "0.9375rem", marginBottom: "1.75rem" }}>{micError}</p>
          <div style={{ display: "flex", gap: "0.75rem", justifyContent: "center" }}>
            <button className="btn btn-secondary" onClick={() => window.location.reload()} style={{ padding: "0.75rem 1.25rem" }}>
              Try again
            </button>
            <Link href="/dashboard" className="btn btn-primary" style={{ padding: "0.75rem 1.25rem" }}>
              Back to dashboard
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const isHost = joinState.hostId === userId;

  return (
    <div style={{
      height: "100vh", display: "flex", flexDirection: "column", overflow: "hidden",
      background: "var(--color-navy-950)",
    }}>
      {/* ---- Header ---- */}
      <div style={{
        flexShrink: 0, padding: "0.625rem 1.25rem",
        borderBottom: "1px solid var(--color-border)",
        background: "rgba(6,11,24,0.85)", backdropFilter: "blur(12px)",
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          {/* Logo */}
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <div style={{
              width: "1.75rem", height: "1.75rem",
              background: "linear-gradient(135deg, #2563eb, #6366f1)",
              borderRadius: "0.5rem",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <Hand size={12} color="white" />
            </div>
            <span style={{ fontWeight: 800, fontSize: "1.05rem" }}>DeafMeet</span>
          </div>

          {/* Code */}
          <button className="meeting-code-badge" onClick={handleCopyCode} title="Click to copy meeting code">
            {meetingCode}
            {codeCopied ? <Check size={13} /> : <Copy size={13} />}
          </button>

          {/* Status */}
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", color: "var(--color-text-secondary)", fontSize: "0.8125rem" }}>
            <span className={statusDotClass(connectionStatus)} />
            {statusLabel(connectionStatus)}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "1.25rem", color: "var(--color-text-secondary)", fontSize: "0.875rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}>
            <Users size={15} />
            {participants.length + 1} participant{participants.length !== 0 ? "s" : ""}
          </div>
          <span style={{ fontFamily: "'JetBrains Mono', monospace" }}>{formatDuration(elapsed)}</span>
        </div>
      </div>

      {/* ---- Main Body (Grid on top, Caption panel on bottom) ---- */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}>
        
        {/* Video grid space */}
        <div style={{
          flex: 1, padding: "0.75rem 1rem", minHeight: 0, overflow: "hidden",
          display: "flex", flexDirection: "column", justifyContent: "center"
        }}>
          <div style={{
            display: "grid",
            gridTemplateColumns: participants.length === 0
              ? "1fr"
              : participants.length === 1
              ? "repeat(2, 1fr)"
              : "repeat(auto-fit, minmax(260px, 1fr))",
            gap: "0.75rem",
            width: "100%",
            maxHeight: "100%",
            margin: "0 auto",
            alignItems: "center",
          }}>
            <ParticipantTile
              name={userName}
              isMuted={isMuted}
              isCameraOff={isCameraOff}
              isSpeaking={localSpeaking}
              isHost={isHost}
              isSelf
              stream={localStream}
              currentCaption={localCaption}
            />
            {participants.map((p: RemoteParticipant) => (
              <RemoteParticipantTile
                key={p.user_id}
                participant={p}
                isHost={p.user_id === joinState.hostId}
              />
            ))}
          </div>
        </div>

        {/* Caption Panel space (28vh fixed height for clear readability) */}
        <div style={{ height: "28vh", flexShrink: 0, overflow: "hidden" }}>
          <CaptionPanel
            participants={participants}
            localUserName={userName}
            localCaption={localCaption}
            localHistory={localCaptionHistory}
            captionStatus={captionStatus}
            onRestartCaptions={restartCaptions}
            onSendManualCaption={sendManualCaption}
          />
        </div>
      </div>

      {/* ---- Control Bar ---- */}
      <div style={{
        flexShrink: 0,
        display: "flex", justifyContent: "center", alignItems: "center",
        gap: "1rem",
        padding: "0.625rem 1.5rem",
        background: "rgba(6,11,24,0.95)",
        backdropFilter: "blur(12px)",
        borderTop: "1px solid var(--color-border)",
      }}>
        <button
          className={`ctrl-btn ${isMuted ? "ctrl-btn-off" : "ctrl-btn-on"}`}
          onClick={toggleMute}
          title={isMuted ? "Unmute Microphone" : "Mute Microphone"}
        >
          {isMuted ? <MicOff size={20} /> : <Mic size={20} />}
        </button>

        <button
          className={`ctrl-btn ${isCameraOff ? "ctrl-btn-off" : "ctrl-btn-on"}`}
          onClick={toggleCamera}
          disabled={!hasCamera}
          title={!hasCamera ? "No camera detected" : isCameraOff ? "Turn Camera On" : "Turn Camera Off"}
          style={!hasCamera ? { opacity: 0.35, cursor: "not-allowed" } : undefined}
        >
          {isCameraOff ? <VideoOff size={20} /> : <Video size={20} />}
        </button>

        {/* Captions toggle/restart circular button */}
        <button
          className={`ctrl-btn ${captionStatus === "active" ? "ctrl-btn-on" : "ctrl-btn-off"}`}
          onClick={restartCaptions}
          title={captionStatus === "active" ? "Captions Active — Click to restart" : "Click to start captions"}
          style={captionStatus === "active" ? {
            background: "rgba(255, 224, 51, 0.15)",
            color: "var(--color-caption)",
            borderColor: "rgba(255, 224, 51, 0.3)",
          } : undefined}
        >
          <Captions size={20} />
        </button>

        <button
          className="btn btn-danger btn-icon-lg"
          onClick={leaveRoom}
          title="Leave Meeting"
          style={{ width: "3.25rem", height: "3.25rem" }}
        >
          <PhoneOff size={18} />
        </button>
      </div>
    </div>
  );
}

function RemoteParticipantTile({ participant, isHost }: { participant: RemoteParticipant; isHost: boolean }) {
  const isSpeaking = useSpeakingDetection(participant.isMuted ? null : participant.stream);
  return (
    <ParticipantTile
      name={participant.user_name}
      isMuted={participant.isMuted}
      isCameraOff={participant.isCameraOff}
      isSpeaking={isSpeaking}
      isHost={isHost}
      isSelf={false}
      stream={participant.stream}
      currentCaption={participant.caption}
    />
  );
}
