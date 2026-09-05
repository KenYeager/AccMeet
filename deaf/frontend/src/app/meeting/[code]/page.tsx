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
import { useAslRecognition } from "@/hooks/useAslRecognition";
import { AslRecognitionPanel } from "./AslRecognitionPanel";
import { meetings, ApiError, API_BASE } from "@/lib/api";
import type { ConnectionStatus, RemoteParticipant, CaptionEntry } from "@/types";
import type { LocalCaptionEntry } from "@/hooks/useWebRTC";

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
    </div>
  );
}

// ---------- ASL sign playback ----------
const SIGN_DISPLAY_MS = 1100;

function SignPlayer({
  playback,
  onDone,
}: {
  playback: { speakerName: string; gifs: { word: string; gif?: string | null }[] } | null;
  onDone: () => void;
}) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    setIndex(0);
  }, [playback]);

  useEffect(() => {
    if (!playback || playback.gifs.length === 0) return;
    const isLast = index >= playback.gifs.length - 1;
    const timer = setTimeout(() => {
      if (isLast) onDone();
      else setIndex(i => i + 1);
    }, SIGN_DISPLAY_MS);
    return () => clearTimeout(timer);
  }, [playback, index, onDone]);

  if (!playback || playback.gifs.length === 0) return null;
  const current = playback.gifs[Math.min(index, playback.gifs.length - 1)];

  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      padding: "1rem",
      flex: 1,
      width: "100%",
      height: "100%",
    }}>
      {/* Large Active GIF / Word Box */}
      <div style={{
        height: "380px",
        width: "100%",
        maxWidth: "460px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(6, 11, 24, 0.95)",
        border: "3px solid rgba(255, 224, 51, 0.7)",
        borderRadius: "1.25rem",
        boxShadow: "0 0 40px rgba(255, 224, 51, 0.3)",
        overflow: "hidden",
        padding: "0.75rem",
      }}>
        {current.gif ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.75rem", width: "100%", height: "100%", justifyContent: "center" }}>
            <img
              key={`${current.word}-${current.gif}`}
              src={`${API_BASE}/gif/${current.gif}`}
              alt={current.word}
              style={{
                height: "300px",
                width: "300px",
                maxWidth: "100%",
                maxHeight: "300px",
                objectFit: "contain",
                borderRadius: "0.75rem",
              }}
            />
            <span style={{ fontSize: "1.25rem", fontWeight: 900, color: "var(--color-caption)", textTransform: "uppercase", letterSpacing: "0.1em" }}>
              {current.word}
            </span>
          </div>
        ) : (
          <div
            key={`${current.word}-text`}
            style={{
              height: "100%",
              width: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "rgba(255, 224, 51, 0.12)",
              borderRadius: "0.75rem",
              color: "var(--color-caption)", fontWeight: 900, fontSize: "3rem",
              letterSpacing: "0.08em",
              textAlign: "center",
              padding: "1.5rem",
            }}
          >
            {current.word}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- ASL Sign Language Panel ----------
function CaptionPanel({
  signPlayback,
  onSignPlaybackDone,
  onRestartCaptions,
  onSendManualCaption,
}: {
  participants: RemoteParticipant[];
  localUserName: string;
  localCaption: string;
  localHistory: LocalCaptionEntry[];
  signPlayback: { speakerName: string; gifs: { word: string; gif?: string | null }[] } | null;
  onSignPlaybackDone: () => void;
  onRestartCaptions: () => void;
  onSendManualCaption: (text: string) => void;
}) {
  const [manualText, setManualText] = useState("");

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualText.trim()) return;
    onSendManualCaption(manualText.trim());
    setManualText("");
  };

  return (
    <div className="caption-panel" style={{
      height: "100%", display: "flex", flexDirection: "column",
      background: "var(--color-caption-bg)",
      backdropFilter: "blur(20px)",
      boxShadow: "var(--shadow-caption)",
    }}>
      {/* Sidebar Header */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0.75rem 1rem",
        borderBottom: "1px solid rgba(255, 224, 51, 0.12)",
        background: "rgba(10, 16, 32, 0.85)",
        flexShrink: 0,
      }}>
        <div style={{
          display: "flex", alignItems: "center", gap: "0.375rem",
          color: "var(--color-caption)", fontWeight: 800, fontSize: "0.875rem",
          textTransform: "uppercase", letterSpacing: "0.06em",
        }}>
          <Sparkles size={15} /> ASL Sign Stream
        </div>

        <button
          onClick={onRestartCaptions}
          className="btn btn-ghost"
          style={{ padding: "0.25rem 0.5rem", fontSize: "0.75rem", gap: "0.25rem" }}
          title="Restart speech recognition"
        >
          <RefreshCw size={12} /> Restart Mic
        </button>
      </div>

      {/* Main active area: Sole Large GIF/Word box */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", minHeight: 0, padding: "1rem" }}>
        {signPlayback && signPlayback.gifs.length > 0 ? (
          <SignPlayer playback={signPlayback} onDone={onSignPlaybackDone} />
        ) : (
          <div style={{
            display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center",
            padding: "2rem 1.5rem", textAlign: "center", gap: "1rem",
          }}>
            <div style={{
              width: "300px", height: "300px", borderRadius: "1.25rem",
              border: "2px dashed rgba(255, 224, 51, 0.3)",
              background: "rgba(6, 11, 24, 0.6)",
              display: "flex", flexDirection: "column",
              alignItems: "center", justifyContent: "center", gap: "1rem",
              boxShadow: "inset 0 0 20px rgba(0,0,0,0.5)",
            }}>
              <Sparkles size={48} color="var(--color-caption)" style={{ opacity: 0.7 }} />
              <span style={{ fontSize: "1.125rem", color: "var(--color-caption)", fontWeight: 800, letterSpacing: "0.08em" }}>
                ASL SIGN BOX
              </span>
            </div>
            <p style={{ color: "var(--color-caption)", fontWeight: 800, fontSize: "1.125rem", marginTop: "0.25rem" }}>
              Ready for ASL Signs
            </p>
            <p style={{ fontSize: "0.875rem", color: "var(--color-text-secondary)", maxWidth: "280px" }}>
              Speak into mic or type below to display ASL sign GIFs.
            </p>
          </div>
        )}
      </div>

      {/* Input bar */}
      <form onSubmit={handleManualSubmit} style={{
        padding: "0.625rem 0.875rem",
        borderTop: "1px solid rgba(255, 224, 51, 0.12)",
        background: "rgba(6, 11, 24, 0.95)",
        display: "flex",
        gap: "0.5rem",
        alignItems: "center",
        flexShrink: 0,
      }}>
        <input
          type="text"
          className="input"
          placeholder="Type message for ASL signs..."
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
            padding: "0.4rem 0.75rem",
            height: "2.25rem",
            fontSize: "0.8125rem",
            background: "linear-gradient(135deg, #ffd000, #f59e0b)",
            color: "#060b18",
            fontWeight: 700,
          }}
        >
          <Send size={13} /> Send
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
  const { userId, userName, setUserName, isDeaf, setIsDeaf, isReady } = useIdentity();

  const [joinState, setJoinState] = useState<JoinState>({ phase: "checking" });
  const [elapsed, setElapsed] = useState(0);
  const [codeCopied, setCodeCopied] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [isLobbyConfirmed, setIsLobbyConfirmed] = useState(false);
  const joinedAtRef = useRef<number | null>(null);

  useEffect(() => {
    if (userName && !nameInput) {
      setNameInput(userName);
    }
  }, [userName, nameInput]);

  useEffect(() => {
    if (!isReady || !userName || !meetingCode || !isLobbyConfirmed) return;
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
  }, [isReady, userId, userName, meetingCode, isLobbyConfirmed]);

  const webrtcUserId = (joinState.phase === "ready" && isLobbyConfirmed) ? userId : undefined;
  const webrtcUserName = (joinState.phase === "ready" && isLobbyConfirmed) ? userName : undefined;

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
    signPlayback,
    clearSignPlayback,
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

  // For Normal users: watch the first remote participant's video stream for ASL signs.
  // If no remote participant has joined (e.g. testing alone), watch the local webcam feed.
  // Must be called unconditionally (Rules of Hooks).
  const remoteParticipantWithStream = participants.find(p => p.stream);
  const targetStream = !isDeaf ? (remoteParticipantWithStream?.stream || localStream) : null;
  const targetName = remoteParticipantWithStream?.user_name || (participants.length === 0 ? `${userName} (Self)` : "Deaf Participant");
  const { entries: aslEntries, isDetecting: aslDetecting, lastSign, clearHistory: clearAslHistory } = useAslRecognition(
    targetStream,
    targetName,
    !isDeaf && !!targetStream,
  );

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

  if (!isLobbyConfirmed) {
    const handleJoinLobby = (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = nameInput.trim();
      if (!trimmed) { toast.error("Enter a name to continue"); return; }
      setUserName(trimmed);
      setIsLobbyConfirmed(true);
    };

    return (
      <div className="page-center">
        <div className="glass-card fade-in container-sm" style={{ padding: "2.5rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "1rem" }}>
            <div style={{
              width: "2.25rem", height: "2.25rem",
              background: "linear-gradient(135deg, #2563eb, #6366f1)",
              borderRadius: "0.625rem",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <Hand size={14} color="white" />
            </div>
            <span style={{ fontWeight: 800, fontSize: "1.125rem" }}>DeafMeet</span>
          </div>

          <h1 style={{ fontSize: "1.375rem", fontWeight: 800, marginBottom: "0.375rem" }}>
            Join Meeting <span style={{ color: "var(--color-caption)" }}>{meetingCode}</span>
          </h1>
          <p style={{ color: "var(--color-text-secondary)", fontSize: "0.9375rem", marginBottom: "1.5rem" }}>
            Enter your display name and select accessibility options before joining.
          </p>

          <form onSubmit={handleJoinLobby} style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
            <div>
              <label style={{ display: "block", fontSize: "0.875rem", fontWeight: 600, marginBottom: "0.375rem", color: "var(--color-text-secondary)" }}>
                Your Display Name
              </label>
              <input
                autoFocus
                type="text"
                className="input"
                placeholder="e.g. Alex Johnson"
                value={nameInput}
                onChange={e => setNameInput(e.target.value)}
                maxLength={50}
                style={{ fontSize: "1rem" }}
              />
            </div>

            <label style={{
              display: "flex",
              alignItems: "center",
              gap: "0.875rem",
              padding: "0.875rem 1rem",
              borderRadius: "0.75rem",
              background: "rgba(15, 23, 42, 0.7)",
              border: isDeaf ? "1px solid rgba(255, 224, 51, 0.4)" : "1px solid var(--color-border)",
              cursor: "pointer",
              userSelect: "none",
              transition: "all 0.2s ease"
            }}>
              <input
                type="checkbox"
                checked={isDeaf}
                onChange={e => setIsDeaf(e.target.checked)}
                style={{ width: "1.25rem", height: "1.25rem", accentColor: "#ffd000", cursor: "pointer" }}
              />
              <div>
                <div style={{ fontWeight: 700, fontSize: "0.9375rem", color: isDeaf ? "var(--color-caption)" : "white" }}>
                  I am Deaf / Hard of Hearing
                </div>
                <div style={{ fontSize: "0.8125rem", color: "var(--color-text-secondary)" }}>
                  {isDeaf ? "Show ASL Sign Language conversion panel" : "Normal user (Hide Sign Language conversion)"}
                </div>
              </div>
            </label>

            <button type="submit" className="btn btn-primary" style={{ padding: "0.875rem", fontSize: "1rem", fontWeight: 700 }}>
              Join Meeting
            </button>
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
          {/* Deaf vs Normal user selection checkbox */}
          <label style={{
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            padding: "0.35rem 0.75rem",
            borderRadius: "0.5rem",
            background: isDeaf ? "rgba(255, 224, 51, 0.15)" : "rgba(255, 255, 255, 0.05)",
            border: isDeaf ? "1px solid rgba(255, 224, 51, 0.3)" : "1px solid var(--color-border)",
            cursor: "pointer",
            userSelect: "none",
            fontSize: "0.8125rem",
            fontWeight: 700,
            color: isDeaf ? "var(--color-caption)" : "var(--color-text-secondary)",
            transition: "all 0.2s ease"
          }}>
            <input
              type="checkbox"
              checked={isDeaf}
              onChange={e => setIsDeaf(e.target.checked)}
              style={{ width: "1rem", height: "1rem", accentColor: "#ffd000", cursor: "pointer" }}
            />
            <span>{isDeaf ? "Deaf User (Show Sign)" : "Normal User (ASL Recognition)"}</span>
          </label>

          <div style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}>
            <Users size={15} />
            {participants.length + 1} participant{participants.length !== 0 ? "s" : ""}
          </div>
          <span style={{ fontFamily: "'JetBrains Mono', monospace" }}>{formatDuration(elapsed)}</span>
        </div>
      </div>

      {/* ---- Main Body: 70% Video | 30% Panel (ASL Signs for Deaf / ASL→English for Normal) ---- */}
      <div style={{ flex: 1, display: "flex", flexDirection: "row", minHeight: 0, overflow: "hidden" }}>

        {/* ---- Video grid + Control Bar ---- */}
        <div style={{
          width: "70%", display: "flex", flexDirection: "column",
          minHeight: 0, overflow: "hidden", borderRight: "1px solid var(--color-border)",

          transition: "width 0.2s ease",
        }}>
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

          {/* Control Bar embedded at bottom */}
          <div style={{
            flexShrink: 0,
            display: "flex", justifyContent: "center", alignItems: "center",
            gap: "1rem",
            padding: "0.75rem 1.5rem",
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

            <button
              className="ctrl-btn ctrl-btn-on"
              onClick={restartCaptions}
              title="Restart mic captions"
              style={{
                background: "rgba(255, 224, 51, 0.15)",
                color: "var(--color-caption)",
                borderColor: "rgba(255, 224, 51, 0.3)",
              }}
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

        {/* ---- Right 30% Panel: Deaf user → ASL Sign Stream | Normal user → ASL→English Recognition ---- */}
        {isDeaf ? (
          <div style={{ width: "30%", height: "100%", overflow: "hidden", display: "flex", flexDirection: "column" }}>
            <CaptionPanel
              participants={participants}
              localUserName={userName}
              localCaption={localCaption}
              localHistory={localCaptionHistory}
              signPlayback={signPlayback}
              onSignPlaybackDone={clearSignPlayback}
              onRestartCaptions={restartCaptions}
              onSendManualCaption={sendManualCaption}
            />
          </div>
        ) : (
          <div style={{ width: "30%", height: "100%", overflow: "hidden", display: "flex", flexDirection: "column" }}>
            <AslRecognitionPanel
              entries={aslEntries}
              isDetecting={aslDetecting}
              lastSign={lastSign}
              onClear={clearAslHistory}
            />
          </div>
        )}
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
