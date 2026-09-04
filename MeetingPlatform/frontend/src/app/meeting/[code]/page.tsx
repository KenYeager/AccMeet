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
  Loader2,
  Mic,
  MicOff,
  PhoneOff,
  Users,
  Video,
  VideoOff,
} from "lucide-react";
import toast from "react-hot-toast";
import { useIdentity } from "@/hooks/useIdentity";
import { useWebRTC } from "@/hooks/useWebRTC";
import { useSpeakingDetection } from "@/hooks/useSpeakingDetection";
import { meetings, ApiError } from "@/lib/api";
import type { ConnectionStatus, RemoteParticipant } from "@/types";

function getInitials(name: string) {
  return name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2);
}

function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60).toString().padStart(2, "0");
  const s = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function statusDotClass(status: ConnectionStatus) {
  if (status === "connected") return "status-dot status-dot-green";
  if (status === "error") return "status-dot status-dot-red";
  return "status-dot status-dot-yellow"; // connecting | disconnected
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

/**
 * Video tile for one participant. The <video> element is always mounted when a
 * stream is present — even with the camera off — because it's also the audio
 * sink; hiding it with CSS (rather than unmounting) keeps audio playing.
 */
function ParticipantTile({
  name,
  isMuted,
  isCameraOff,
  isSpeaking,
  isHost,
  isSelf,
  stream,
}: {
  name: string;
  isMuted: boolean;
  isCameraOff: boolean;
  isSpeaking: boolean;
  isHost: boolean;
  isSelf: boolean;
  stream?: MediaStream | null;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream ?? null;
  }, [stream]);

  const showVideo = !!stream?.getVideoTracks().length && !isCameraOff;
  const nameRow = (
    <span style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: "0.375rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
      {name} {isSelf && <span style={{ color: "var(--color-text-muted)" }}>(you)</span>}
      {isHost && (
        <span title="Host" style={{ display: "inline-flex", flexShrink: 0 }}>
          <Crown size={13} color="var(--color-warning)" />
        </span>
      )}
    </span>
  );

  return (
    <div
      className="glass-card participant-card"
      style={{
        position: "relative",
        overflow: "hidden",
        aspectRatio: "4 / 3",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        boxShadow: isSpeaking && !isMuted ? "0 0 0 3px var(--color-success), var(--shadow-card)" : undefined,
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
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.875rem", padding: "1.5rem", textAlign: "center" }}>
          <div style={{ position: "relative" }}>
            <div className="avatar avatar-lg">{getInitials(name || "?")}</div>
            <div
              style={{
                position: "absolute",
                bottom: -2,
                right: -2,
                width: "1.5rem",
                height: "1.5rem",
                borderRadius: "50%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: isMuted ? "var(--color-danger)" : "var(--color-navy-800)",
                border: "2px solid var(--color-navy-950)",
                color: isMuted ? "white" : "var(--color-success)",
              }}
              title={isMuted ? "Muted" : "Unmuted"}
            >
              {isMuted ? <MicOff size={11} /> : <Mic size={11} />}
            </div>
          </div>
          <div style={{ fontSize: "0.9375rem" }}>{nameRow}</div>
        </div>
      )}

      {showVideo && (
        <div
          style={{
            position: "absolute",
            left: "0.625rem",
            right: "0.625rem",
            bottom: "0.625rem",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "0.5rem",
            padding: "0.375rem 0.625rem",
            background: "rgba(6, 11, 24, 0.65)",
            backdropFilter: "blur(6px)",
            borderRadius: "0.75rem",
            fontSize: "0.8125rem",
          }}
        >
          {nameRow}
          <span
            style={{ display: "flex", flexShrink: 0, color: isMuted ? "var(--color-danger)" : "var(--color-success)" }}
            title={isMuted ? "Muted" : "Unmuted"}
          >
            {isMuted ? <MicOff size={14} /> : <Mic size={14} />}
          </span>
        </div>
      )}
    </div>
  );
}

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

  // Validate the meeting and register as a participant before opening WebRTC.
  useEffect(() => {
    if (!isReady || !userName || !meetingCode) return;
    let cancelled = false;

    (async () => {
      try {
        const details = await meetings.get(meetingCode);
        if (details.meeting.status === "ended") {
          if (!cancelled) {
            setJoinState({
              phase: "error",
              title: "Meeting has ended",
              message: "This meeting is no longer active.",
            });
          }
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
          setJoinState({
            phase: "error",
            title: "Meeting doesn't exist",
            message: "Double-check the meeting code and try again.",
          });
          return;
        }
        const message = err instanceof ApiError ? err.message : "Something went wrong joining this meeting.";
        setJoinState({ phase: "error", title: "Can't join meeting", message });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isReady, userId, userName, meetingCode]);

  // Only hand a real identity to useWebRTC once join validation succeeds —
  // the hook connects as soon as both are truthy.
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
    toggleMute,
    toggleCamera,
    leaveRoom,
  } = useWebRTC(meetingCode, webrtcUserId, webrtcUserName);

  // Meeting duration timer
  useEffect(() => {
    if (joinState.phase !== "ready") return;
    const interval = setInterval(() => {
      if (joinedAtRef.current) {
        setElapsed(Math.floor((Date.now() - joinedAtRef.current) / 1000));
      }
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

  // ---------------------------------------------------------------
  // Identity gate — no accounts, just ask for a name once
  // ---------------------------------------------------------------
  if (!isReady) {
    return (
      <div className="page-center">
        <Loader2 size={28} className="animate-spin" color="var(--color-blue-400)" />
      </div>
    );
  }

  if (!userName) {
    const handleSubmitName = (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = nameInput.trim();
      if (!trimmed) {
        toast.error("Enter a name to continue");
        return;
      }
      setUserName(trimmed);
    };

    return (
      <div className="page-center">
        <div className="glass-card fade-in container-sm" style={{ padding: "2.5rem" }}>
          <h1 style={{ fontSize: "1.25rem", fontWeight: 700, marginBottom: "0.5rem" }}>
            Join meeting {meetingCode}
          </h1>
          <p style={{ color: "var(--color-text-secondary)", fontSize: "0.9375rem", marginBottom: "1.5rem" }}>
            Enter your name to continue.
          </p>
          <form onSubmit={handleSubmitName} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <input
              autoFocus
              type="text"
              className="input"
              placeholder="e.g. Alex Johnson"
              value={nameInput}
              onChange={e => setNameInput(e.target.value)}
              maxLength={50}
            />
            <button type="submit" className="btn btn-primary" style={{ padding: "0.75rem" }}>
              Continue
            </button>
          </form>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------
  // Error / not-ready states
  // ---------------------------------------------------------------
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
          <div
            style={{
              width: "3.5rem",
              height: "3.5rem",
              borderRadius: "50%",
              background: "rgba(239, 68, 68, 0.12)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto 1.25rem",
              color: "var(--color-danger)",
            }}
          >
            <AlertTriangle size={24} />
          </div>
          <h1 style={{ fontSize: "1.25rem", fontWeight: 700, marginBottom: "0.5rem" }}>
            {joinState.title}
          </h1>
          <p style={{ color: "var(--color-text-secondary)", fontSize: "0.9375rem", marginBottom: "1.75rem" }}>
            {joinState.message}
          </p>
          <Link href="/dashboard" className="btn btn-primary" style={{ padding: "0.75rem 1.5rem" }}>
            <ArrowLeft size={16} />
            Back to dashboard
          </Link>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------
  // Mic permission error (blocking modal)
  // ---------------------------------------------------------------
  if (micError) {
    return (
      <div className="page-center">
        <div className="glass-card fade-in container-sm" style={{ padding: "2.5rem", textAlign: "center" }}>
          <div
            style={{
              width: "3.5rem",
              height: "3.5rem",
              borderRadius: "50%",
              background: "rgba(245, 158, 11, 0.12)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto 1.25rem",
              color: "var(--color-warning)",
            }}
          >
            <MicOff size={24} />
          </div>
          <h1 style={{ fontSize: "1.25rem", fontWeight: 700, marginBottom: "0.5rem" }}>
            Microphone unavailable
          </h1>
          <p style={{ color: "var(--color-text-secondary)", fontSize: "0.9375rem", marginBottom: "1.75rem" }}>
            {micError}
          </p>
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
    <div style={{ minHeight: "100vh", padding: "1.5rem", display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <div className="container-lg fade-in" style={{ marginBottom: "2rem" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: "1rem",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
            <button
              className="meeting-code-badge"
              onClick={handleCopyCode}
              title="Click to copy meeting code"
              style={{ border: "1px solid rgba(59, 130, 246, 0.25)" }}
            >
              {meetingCode}
              {codeCopied ? <Check size={14} /> : <Copy size={14} />}
            </button>

            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", color: "var(--color-text-secondary)", fontSize: "0.875rem" }}>
              <span className={statusDotClass(connectionStatus)} />
              {statusLabel(connectionStatus)}
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "1.25rem", color: "var(--color-text-secondary)", fontSize: "0.875rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}>
              <Users size={15} />
              {participants.length + 1}
            </div>
            <span style={{ fontFamily: "'JetBrains Mono', 'Fira Code', monospace" }}>
              {formatDuration(elapsed)}
            </span>
          </div>
        </div>
      </div>

      {/* Participant grid */}
      <div className="container-lg" style={{ flex: 1 }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
            gap: "1.25rem",
          }}
        >
          <ParticipantTile
            name={userName}
            isMuted={isMuted}
            isCameraOff={isCameraOff}
            isSpeaking={localSpeaking}
            isHost={isHost}
            isSelf
            stream={localStream}
          />
          {participants.map((p: RemoteParticipant) => (
            <RemoteParticipantTile
              key={p.user_id}
              participant={p}
              isHost={p.user_id === joinState.hostId}
            />
          ))}
        </div>

        {participants.length === 0 && (
          <p style={{ textAlign: "center", color: "var(--color-text-muted)", marginTop: "2.5rem", fontSize: "0.9375rem" }}>
            Waiting for others to join — share the code above.
          </p>
        )}
      </div>

      {/* Controls */}
      <div
        className="container-lg fade-in"
        style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: "1.5rem", padding: "2rem 0 0.5rem" }}
      >
        <button
          className={`mute-btn ${isMuted ? "mute-btn-muted" : "mute-btn-active"}`}
          onClick={toggleMute}
          title={isMuted ? "Unmute" : "Mute"}
        >
          {isMuted ? <MicOff size={24} /> : <Mic size={24} />}
        </button>
        <button
          className={`mute-btn ${isCameraOff ? "mute-btn-muted" : "mute-btn-active"}`}
          onClick={toggleCamera}
          disabled={!hasCamera}
          title={!hasCamera ? "No camera detected" : isCameraOff ? "Turn camera on" : "Turn camera off"}
          style={!hasCamera ? { opacity: 0.4, cursor: "not-allowed" } : undefined}
        >
          {isCameraOff ? <VideoOff size={24} /> : <Video size={24} />}
        </button>
        <button className="btn btn-danger btn-icon-lg" onClick={leaveRoom} title="Leave meeting">
          <PhoneOff size={22} />
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
    />
  );
}
