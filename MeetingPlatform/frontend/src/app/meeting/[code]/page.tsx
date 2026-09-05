"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  BookOpen,
  BrainCircuit,
  Captions,
  CaptionsOff,
  Check,
  Copy,
  Crown,
  Lightbulb,
  Loader2,
  Mic,
  MicOff,
  PhoneOff,
  Sparkles,
  Users,
  Video,
  VideoOff,
  X,
} from "lucide-react";
import toast from "react-hot-toast";
import { useIdentity } from "@/hooks/useIdentity";
import { useWebRTC } from "@/hooks/useWebRTC";
import { useConversationMemory } from "@/hooks/useConversationMemory";
import { useRagOrchestrator } from "@/hooks/useRagOrchestrator";
import { useSpeakingDetection } from "@/hooks/useSpeakingDetection";
import { meetings, ApiError } from "@/lib/api";
import type { CaregiverTipPayload, ConnectionStatus, ConversationHistoryEntry, RagQueryResponse, RemoteParticipant } from "@/types";

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
  const searchParams = useSearchParams();
  // ?patient=1 is a dev/demo shortcut — there's no real role/auth system in
  // this app, participants are otherwise fully symmetric.
  const isPatient = searchParams.get("patient") === "1";
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

  // Populated after useConversationMemory/useRagOrchestrator are created
  // below — declared first (as refs, not state) purely to break the
  // ordering cycle: useWebRTC needs stable-identity callbacks to call on
  // every final caption, but those callbacks belong to hooks that
  // themselves need `participants` — which only exists once useWebRTC has run.
  const conversationMemoryRef = useRef<{ addUtterance: (fromUserId: string, text: string) => void } | null>(null);
  const ragOrchestratorRef = useRef<{ addUtterance: (fromUserId: string, text: string) => void } | null>(null);

  // Caregiver-tip card is patient-only to COMPUTE but non-patient-only to
  // SHOW — see useConversationMemory (computes + sends) and useWebRTC's
  // onCaregiverTip (receives, targeted delivery, see backend RELAY_TYPES).
  const [caregiverTip, setCaregiverTip] = useState<CaregiverTipPayload | null>(null);

  const {
    localStream,
    participants,
    isMuted,
    isCameraOff,
    hasCamera,
    connectionStatus,
    micError,
    captionsEnabled,
    localCaption,
    toggleMute,
    toggleCamera,
    toggleCaptions,
    sendCaregiverTip,
    leaveRoom,
  } = useWebRTC(meetingCode, webrtcUserId, webrtcUserName, (fromUserId, text) => {
    conversationMemoryRef.current?.addUtterance(fromUserId, text);
    ragOrchestratorRef.current?.addUtterance(fromUserId, text);
  }, setCaregiverTip);

  // 1:1 calls only (confirmed scope) — the dyad partner is simply "the one
  // other participant," no active-speaker tracking needed.
  const otherParticipant = participants.length === 1
    ? { user_id: participants[0].user_id, user_name: participants[0].user_name }
    : null;

  const conversationMemory = useConversationMemory(meetingCode, isPatient, webrtcUserId, otherParticipant, sendCaregiverTip);
  useEffect(() => {
    conversationMemoryRef.current = conversationMemory;
  }, [conversationMemory]);

  // Runs for every participant (not just the patient) — the automated
  // LangGraph orchestrator replacing the old manual ingest/retrieve toggles.
  const ragOrchestrator = useRagOrchestrator(isPatient, webrtcUserId);
  useEffect(() => {
    ragOrchestratorRef.current = ragOrchestrator;
  }, [ragOrchestrator]);

  // Caregiver tip auto-dismisses so it doesn't linger and clutter the call —
  // a fresh tip resets the timer.
  useEffect(() => {
    if (!caregiverTip) return;
    const timer = setTimeout(() => setCaregiverTip(null), 20000);
    return () => clearTimeout(timer);
  }, [caregiverTip]);

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

  // Condense + persist this call's conversation-memory session before
  // actually leaving — see useConversationMemory's documented limitation
  // (an abrupt tab close skips this).
  const handleLeave = async () => {
    if (isPatient) {
      await conversationMemory.finalize();
    }
    await leaveRoom();
  };

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
      {/* HUD — background context automatically surfaced by the LangGraph
          orchestrator for the patient only (see useRagOrchestrator; the
          non-patient graph variant never even has the lookup tool bound,
          so hudCard/hudLoading can never be true for a non-patient client —
          this isPatient check is defense-in-depth, not the real guarantee). */}
      {isPatient && (ragOrchestrator.hudLoading || ragOrchestrator.hudCard) && (
        <HudCard loading={ragOrchestrator.hudLoading} data={ragOrchestrator.hudCard} onDismiss={ragOrchestrator.dismissHud} />
      )}

      {/* Repetition-watch tip — computed on the PATIENT's client (see
          useConversationMemory) but relayed and shown only to the OTHER
          participant, never the patient themselves. */}
      {!isPatient && caregiverTip && (
        <CaregiverTipCard tip={caregiverTip} onDismiss={() => setCaregiverTip(null)} />
      )}

      {/* Conversation memory — patient-only, fully automatic (see useConversationMemory) */}
      {isPatient && (
        <>
          <ContextBubble context={conversationMemory.currentContext} summary={conversationMemory.sessionSummary} />
          <HistoryBubble
            entries={conversationMemory.history}
            loading={conversationMemory.historyLoading}
            onOpen={conversationMemory.fetchHistory}
          />
        </>
      )}

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

      {/* Live captions */}
      {captionsEnabled && (
        <CaptionBar
          entries={[
            ...(localCaption ? [{ id: "self", name: `${userName} (you)`, text: localCaption }] : []),
            ...participants
              .filter(p => p.caption)
              .map(p => ({ id: p.user_id, name: p.user_name, text: p.caption! })),
          ]}
        />
      )}

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
        <button
          className={`mute-btn ${captionsEnabled ? "mute-btn-active" : "mute-btn-muted"}`}
          onClick={toggleCaptions}
          title={captionsEnabled ? "Turn off live captions" : "Turn on live captions"}
        >
          {captionsEnabled ? <Captions size={24} /> : <CaptionsOff size={24} />}
        </button>
        <button className="btn btn-danger btn-icon-lg" onClick={handleLeave} title="Leave meeting">
          <PhoneOff size={22} />
        </button>
      </div>
    </div>
  );
}

/**
 * Background-context card from the rag agent — shown while retrieval is on
 * and something worth surfacing was mentioned. Unlike CaptionBar this
 * doesn't auto-clear on a timer: the point is to read it, so it stays until
 * dismissed or replaced by the next triggered lookup.
 */
function HudCard({
  loading,
  data,
  onDismiss,
}: {
  loading: boolean;
  data: RagQueryResponse | null;
  onDismiss: () => void;
}) {
  return (
    <div
      className="glass-card fade-in"
      style={{
        position: "fixed",
        top: "1.5rem",
        right: "1.5rem",
        zIndex: 50,
        width: "20rem",
        maxWidth: "calc(100vw - 3rem)",
        padding: "1rem 1.125rem",
        background: "rgba(6, 11, 24, 0.85)",
        backdropFilter: "blur(8px)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.5rem" }}>
        <span style={{ display: "flex", alignItems: "center", gap: "0.375rem", fontSize: "0.75rem", fontWeight: 700, letterSpacing: "0.03em", textTransform: "uppercase", color: "var(--color-blue-400)" }}>
          <BrainCircuit size={14} />
          Context
        </span>
        {!loading && (
          <button
            onClick={onDismiss}
            title="Dismiss"
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-text-muted)", display: "flex", padding: 0 }}
          >
            <X size={16} />
          </button>
        )}
      </div>

      {loading && !data && (
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", color: "var(--color-text-secondary)", fontSize: "0.875rem" }}>
          <Loader2 size={16} className="animate-spin" />
          Looking that up…
        </div>
      )}

      {data && (
        <div>
          {data.query && (
            <p style={{ fontSize: "0.75rem", color: "var(--color-text-muted)", margin: "0 0 0.375rem" }}>
              &quot;{data.query}&quot;
            </p>
          )}
          <p style={{ fontSize: "0.875rem", lineHeight: 1.5, color: "white", margin: 0, whiteSpace: "pre-wrap" }}>
            {data.hud_card_data}
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * Amber-toned suggestion card shown only to the non-patient participant when
 * the patient repeats a question or fact (see conversation_memory.py's
 * patient_repeated detection). Distinct styling from HudCard so the two are
 * never mistaken for each other, though in practice they never render for
 * the same user at once (HudCard is patient-only, this is non-patient-only).
 */
function CaregiverTipCard({ tip, onDismiss }: { tip: CaregiverTipPayload; onDismiss: () => void }) {
  return (
    <div
      className="glass-card fade-in"
      style={{
        position: "fixed",
        top: "1.5rem",
        right: "1.5rem",
        zIndex: 50,
        width: "22rem",
        maxWidth: "calc(100vw - 3rem)",
        padding: "1rem 1.125rem",
        background: "rgba(28, 20, 4, 0.9)",
        border: "1px solid rgba(217, 158, 46, 0.35)",
        backdropFilter: "blur(8px)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.5rem" }}>
        <span style={{ display: "flex", alignItems: "center", gap: "0.375rem", fontSize: "0.75rem", fontWeight: 700, letterSpacing: "0.03em", textTransform: "uppercase", color: "#e0a530" }}>
          <Lightbulb size={14} />
          Gentle reminder
        </span>
        <button
          onClick={onDismiss}
          title="Dismiss"
          style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-text-muted)", display: "flex", padding: 0 }}
        >
          <X size={16} />
        </button>
      </div>

      {tip.repeated_topic && (
        <p style={{ fontSize: "0.75rem", color: "var(--color-text-muted)", margin: "0 0 0.375rem" }}>
          They may be {tip.repeated_topic}
        </p>
      )}
      <p style={{ fontSize: "0.875rem", lineHeight: 1.5, color: "white", margin: 0, whiteSpace: "pre-wrap" }}>
        {tip.suggestion}
      </p>
    </div>
  );
}

/**
 * Top-left bubble showing the live "what's being talked about right now"
 * phrase — updates every ~30s (see useConversationMemory). Click expands it
 * into the running summary of THIS call so far.
 */
function ContextBubble({ context, summary }: { context: string; summary: string }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className="glass-card fade-in"
      onClick={() => setExpanded(prev => !prev)}
      title={expanded ? "Click to collapse" : "Click to see the full summary of this call"}
      style={{
        position: "fixed",
        top: "1.5rem",
        left: "1.5rem",
        zIndex: 50,
        width: expanded ? "22rem" : "auto",
        maxWidth: "calc(100vw - 3rem)",
        padding: expanded ? "1rem 1.125rem" : "0.625rem 1rem",
        background: "rgba(6, 11, 24, 0.85)",
        backdropFilter: "blur(8px)",
        cursor: "pointer",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem" }}>
        <span style={{ display: "flex", alignItems: "center", gap: "0.375rem", fontSize: "0.75rem", fontWeight: 700, letterSpacing: "0.03em", textTransform: "uppercase", color: "var(--color-blue-400)" }}>
          <Sparkles size={14} />
          Right now
        </span>
        {expanded && (
          <button
            onClick={e => { e.stopPropagation(); setExpanded(false); }}
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-text-muted)", display: "flex", padding: 0 }}
          >
            <X size={16} />
          </button>
        )}
      </div>

      {!expanded && (
        <p style={{
          fontSize: "0.875rem", color: "white", margin: "0.25rem 0 0", maxWidth: "16rem",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {context || "Listening…"}
        </p>
      )}

      {expanded && (
        <p style={{ fontSize: "0.875rem", lineHeight: 1.5, color: "white", margin: "0.5rem 0 0", whiteSpace: "pre-wrap" }}>
          {summary || "Nothing summarized yet — keep talking for about 30 seconds."}
        </p>
      )}
    </div>
  );
}

/**
 * Bottom-right bubble — click fetches and shows the story-style history of
 * PAST calls with this exact other participant (never mixed with anyone
 * else's history — see conversation_memory.py's per-dyad file scoping).
 */
function HistoryBubble({
  entries,
  loading,
  onOpen,
}: {
  entries: ConversationHistoryEntry[];
  loading: boolean;
  onOpen: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const handleClick = () => {
    const next = !expanded;
    setExpanded(next);
    if (next) onOpen();
  };

  return (
    <div
      className="glass-card fade-in"
      onClick={handleClick}
      title={expanded ? "Click to collapse" : "Click to see past conversations"}
      style={{
        position: "fixed",
        bottom: "1.5rem",
        right: "1.5rem",
        zIndex: 50,
        width: expanded ? "22rem" : "auto",
        maxWidth: "calc(100vw - 3rem)",
        maxHeight: expanded ? "60vh" : "auto",
        display: "flex",
        flexDirection: "column",
        padding: expanded ? "1rem 1.125rem" : "0.625rem 1rem",
        background: "rgba(6, 11, 24, 0.85)",
        backdropFilter: "blur(8px)",
        cursor: "pointer",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem", flexShrink: 0 }}>
        <span style={{ display: "flex", alignItems: "center", gap: "0.375rem", fontSize: "0.75rem", fontWeight: 700, letterSpacing: "0.03em", textTransform: "uppercase", color: "var(--color-blue-400)" }}>
          <BookOpen size={14} />
          Past conversations
        </span>
        {expanded && (
          <button
            onClick={e => { e.stopPropagation(); setExpanded(false); }}
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-text-muted)", display: "flex", padding: 0 }}
          >
            <X size={16} />
          </button>
        )}
      </div>

      {expanded && (
        <div style={{ overflowY: "auto", marginTop: "0.625rem" }} onClick={e => e.stopPropagation()}>
          {loading && (
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", color: "var(--color-text-secondary)", fontSize: "0.875rem" }}>
              <Loader2 size={16} className="animate-spin" />
              Loading…
            </div>
          )}
          {!loading && entries.length === 0 && (
            <p style={{ fontSize: "0.875rem", color: "var(--color-text-muted)", margin: 0 }}>
              No past conversations with this person yet.
            </p>
          )}
          {!loading && entries.map((entry, i) => (
            <div key={i} style={{ marginBottom: "0.75rem" }}>
              <p style={{ fontSize: "0.75rem", color: "var(--color-text-muted)", margin: "0 0 0.25rem" }}>
                {entry.timestamp}
              </p>
              <p style={{ fontSize: "0.875rem", lineHeight: 1.5, color: "white", margin: 0 }}>
                {entry.summary}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Fixed subtitle bar showing whoever currently has live caption text —
 * cleared a few seconds after each speaker goes quiet (see useWebRTC).
 */
function CaptionBar({ entries }: { entries: { id: string; name: string; text: string }[] }) {
  if (entries.length === 0) return null;
  return (
    <div className="container-lg fade-in" style={{ display: "flex", justifyContent: "center", padding: "0 0 0.75rem" }}>
      <div
        style={{
          maxWidth: "48rem",
          width: "100%",
          background: "rgba(6, 11, 24, 0.75)",
          backdropFilter: "blur(6px)",
          borderRadius: "0.75rem",
          padding: "0.75rem 1.25rem",
          display: "flex",
          flexDirection: "column",
          gap: "0.25rem",
        }}
      >
        {entries.map(entry => (
          <p key={entry.id} style={{ fontSize: "0.9375rem", lineHeight: 1.4, color: "white", margin: 0 }}>
            <span style={{ fontWeight: 600, color: "var(--color-blue-400)" }}>{entry.name}: </span>
            {entry.text}
          </p>
        ))}
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
