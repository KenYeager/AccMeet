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
  ChevronDown,
  ChevronUp,
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
        aspectRatio: "var(--tile-aspect)",
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
          <div style={{ fontSize: "var(--fs-body)" }}>{nameRow}</div>
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
            fontSize: "var(--fs-label)",
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
  // Patient mode only — an accidental hang-up is a real failure mode when
  // leaving also finalizes this call's conversation history.
  const [confirmingLeave, setConfirmingLeave] = useState(false);
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
          <h1 style={{ fontSize: "var(--fs-title)", fontWeight: 700, marginBottom: "0.5rem" }}>
            Join meeting {meetingCode}
          </h1>
          <p style={{ color: "var(--color-text-secondary)", fontSize: "var(--fs-body)", marginBottom: "1.5rem" }}>
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
          <h1 style={{ fontSize: "var(--fs-title)", fontWeight: 700, marginBottom: "0.5rem" }}>
            {joinState.title}
          </h1>
          <p style={{ color: "var(--color-text-secondary)", fontSize: "var(--fs-body)", marginBottom: "1.75rem" }}>
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
          <h1 style={{ fontSize: "var(--fs-title)", fontWeight: 700, marginBottom: "0.5rem" }}>
            Microphone unavailable
          </h1>
          <p style={{ color: "var(--color-text-secondary)", fontSize: "var(--fs-body)", marginBottom: "1.75rem" }}>
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
    <div
      className={isPatient ? "patient-mode" : undefined}
      style={{
        // The patient screen is locked to the viewport and never scrolls —
        // reaching the controls must never require finding a scrollbar.
        // Everything below flexes to fit instead.
        ...(isPatient
          ? { height: "100dvh", overflow: "hidden" }
          : { minHeight: "100vh" }),
        padding: "1.5rem",
        display: "flex",
        flexDirection: "column",
      }}
    >
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

      {/* Header. The patient keeps the meeting code (they may need to read it
          out to whoever is joining) plus the connection state in plain words,
          but loses the participant count and duration timer — neither is
          useful mid-call, and both cost attention and vertical space. */}
      <div className="container-lg fade-in" style={{ marginBottom: "1.25rem", flexShrink: 0 }}>
        {isPatient ? (
          <div style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
            <button
              className="meeting-code-badge"
              onClick={handleCopyCode}
              style={{ border: "1px solid rgba(59, 130, 246, 0.25)", padding: "0.5rem 1rem" }}
            >
              {meetingCode}
              {codeCopied ? <Check size={18} /> : <Copy size={18} />}
            </button>
            <span style={{ fontSize: "var(--fs-label)", color: "var(--color-text-secondary)" }}>
              {codeCopied ? "Code copied" : "Tap the code to copy it"}
            </span>
            <div style={{ display: "flex", alignItems: "center", gap: "0.625rem", color: "var(--color-text-secondary)", fontSize: "var(--fs-label)", marginLeft: "auto" }}>
              <span className={statusDotClass(connectionStatus)} />
              {connectionStatus === "connected"
                ? participants.length > 0 ? `Talking to ${participants[0].user_name}` : "Waiting for them to join…"
                : statusLabel(connectionStatus)}
            </div>
          </div>
        ) : (
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

              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", color: "var(--color-text-secondary)", fontSize: "var(--fs-label)" }}>
                <span className={statusDotClass(connectionStatus)} />
                {statusLabel(connectionStatus)}
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "1.25rem", color: "var(--color-text-secondary)", fontSize: "var(--fs-label)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}>
                <Users size={15} />
                {participants.length + 1}
              </div>
              <span style={{ fontFamily: "'JetBrains Mono', 'Fira Code', monospace" }}>
                {formatDuration(elapsed)}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Participant grid. --tile-min widens substantially in patient mode so
          a 1:1 call fills the screen with the person's face rather than
          sitting in a small grid cell. */}
      <div className="container-lg" style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, var(--tile-min)), var(--tile-max)))",
            justifyContent: "center",
            gap: "1.25rem",
            // Absorbs whatever height is left once header, strip and controls
            // have taken theirs — so expanding the history panel shrinks the
            // video rather than pushing the controls off-screen.
            ...(isPatient ? { flex: 1, minHeight: 0 } : {}),
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
          <p style={{ textAlign: "center", color: "var(--color-text-muted)", marginTop: "2.5rem", fontSize: "var(--fs-body)" }}>
            {isPatient ? "Waiting for them to join…" : "Waiting for others to join — share the code above."}
          </p>
        )}
      </div>

      {/* Conversation memory — patient-only, fully automatic (see
          useConversationMemory). These used to be two small floating bubbles
          in opposite screen corners; they're now one predictable in-flow
          strip directly under the video, so nothing overlaps the call and
          the patient always finds them in the same place. */}
      {isPatient && (
        <div className="container-lg" style={{ marginTop: "1rem", display: "flex", flexDirection: "column", gap: "0.75rem", flexShrink: 0 }}>
          <ContextBubble context={conversationMemory.currentContext} summary={conversationMemory.sessionSummary} />
          <HistoryBubble
            entries={conversationMemory.history}
            loading={conversationMemory.historyLoading}
            onOpen={conversationMemory.fetchHistory}
          />
        </div>
      )}

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

      {/* Controls. Every button now carries a visible text label — the old
          bare circles put their meaning in a `title` tooltip, which a touch
          user can never surface. Colour is never the only signal: state is
          in the words, and Leave is a pill rather than a circle so it can't
          be mistaken for a muted mic. */}
      <div
        className="container-lg fade-in"
        style={{ display: "flex", justifyContent: "center", alignItems: "flex-start", flexWrap: "wrap", gap: "1.75rem", padding: "1.25rem 0 0.25rem", flexShrink: 0 }}
      >
        <button
          className={`control-btn ${isMuted ? "control-btn-alert" : "control-btn-on"}`}
          onClick={toggleMute}
        >
          <span className="control-btn-face">{isMuted ? <MicOff /> : <Mic />}</span>
          <span className="control-btn-label">{isMuted ? "Muted" : "Mic on"}</span>
        </button>

        <button
          className={`control-btn ${isCameraOff ? "control-btn-off" : "control-btn-on"}`}
          onClick={toggleCamera}
          disabled={!hasCamera}
        >
          <span className="control-btn-face">{isCameraOff ? <VideoOff /> : <Video />}</span>
          <span className="control-btn-label">
            {!hasCamera ? "No camera" : isCameraOff ? "Camera off" : "Camera on"}
          </span>
        </button>

        <button
          className={`control-btn ${captionsEnabled ? "control-btn-on" : "control-btn-off"}`}
          onClick={toggleCaptions}
        >
          <span className="control-btn-face">{captionsEnabled ? <Captions /> : <CaptionsOff />}</span>
          <span className="control-btn-label">{captionsEnabled ? "Subtitles on" : "Subtitles off"}</span>
        </button>

        <button
          className="control-leave"
          onClick={() => (isPatient ? setConfirmingLeave(true) : handleLeave())}
        >
          <PhoneOff />
          Leave call
        </button>
      </div>

      {isPatient && confirmingLeave && (
        <LeaveConfirm onCancel={() => setConfirmingLeave(false)} onConfirm={handleLeave} />
      )}
    </div>
  );
}

/**
 * Patient-mode-only guard on hanging up. Leaving also finalizes and persists
 * this call's conversation history, so a mis-tap costs more than a dropped
 * call — and the safe option is the one that's visually dominant.
 */
function LeaveConfirm({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        background: "rgba(6, 11, 24, 0.8)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "1.5rem",
      }}
    >
      <div className="glass-card fade-in" style={{ padding: "2.5rem", maxWidth: "32rem", textAlign: "center" }}>
        <h2 style={{ fontSize: "var(--fs-title)", fontWeight: 700, margin: "0 0 0.75rem" }}>
          End this call?
        </h2>
        <p style={{ fontSize: "var(--fs-body)", color: "var(--color-text-secondary)", lineHeight: 1.5, margin: "0 0 2rem" }}>
          You can always call again later.
        </p>
        <div style={{ display: "flex", gap: "1rem", justifyContent: "center", flexWrap: "wrap" }}>
          <button className="btn btn-primary" onClick={onCancel} style={{ padding: "1rem 2rem", fontSize: "var(--fs-body)" }}>
            Stay on the call
          </button>
          <button className="btn btn-danger" onClick={onConfirm} style={{ padding: "1rem 2rem", fontSize: "var(--fs-body)" }}>
            Yes, end call
          </button>
        </div>
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
        width: "var(--overlay-width)",
        maxWidth: "calc(100vw - 3rem)",
        padding: "1.125rem 1.25rem",
        background: "rgba(6, 11, 24, 0.92)",
        backdropFilter: "blur(8px)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem", marginBottom: "0.625rem" }}>
        <span style={panelLabelStyle}>
          <BrainCircuit size={16} />
          Remember
        </span>
        {!loading && (
          <button
            onClick={onDismiss}
            aria-label="Dismiss reminder"
            style={{ display: "flex", alignItems: "center", gap: "0.375rem", background: "none", border: "none", cursor: "pointer", color: "var(--color-text-secondary)", font: "inherit", fontSize: "var(--fs-label)", padding: "0.25rem" }}
          >
            Hide
            <X size={18} />
          </button>
        )}
      </div>

      {loading && !data && (
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", color: "var(--color-text-secondary)", fontSize: "var(--fs-body)" }}>
          <Loader2 size={18} className="animate-spin" />
          Looking that up…
        </div>
      )}

      {data && (
        <div>
          {data.query && (
            <p style={{ fontSize: "var(--fs-label)", color: "var(--color-text-muted)", margin: "0 0 0.375rem" }}>
              &quot;{data.query}&quot;
            </p>
          )}
          <p style={{ fontSize: "var(--fs-body)", lineHeight: 1.5, color: "white", margin: 0, whiteSpace: "pre-wrap" }}>
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
        width: "var(--overlay-width)",
        maxWidth: "calc(100vw - 3rem)",
        padding: "1.125rem 1.25rem",
        background: "rgba(28, 20, 4, 0.92)",
        border: "1px solid rgba(217, 158, 46, 0.35)",
        backdropFilter: "blur(8px)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem", marginBottom: "0.625rem" }}>
        <span style={{ ...panelLabelStyle, color: "#e0a530" }}>
          <Lightbulb size={16} />
          Gentle reminder
        </span>
        <button
          onClick={onDismiss}
          aria-label="Dismiss suggestion"
          style={{ display: "flex", alignItems: "center", gap: "0.375rem", background: "none", border: "none", cursor: "pointer", color: "var(--color-text-secondary)", font: "inherit", fontSize: "var(--fs-label)", padding: "0.25rem" }}
        >
          Hide
          <X size={18} />
        </button>
      </div>

      {tip.repeated_topic && (
        <p style={{ fontSize: "var(--fs-label)", color: "var(--color-text-secondary)", margin: "0 0 0.375rem" }}>
          They may be {tip.repeated_topic}
        </p>
      )}
      <p style={{ fontSize: "var(--fs-body)", lineHeight: 1.5, color: "white", margin: 0, whiteSpace: "pre-wrap" }}>
        {tip.suggestion}
      </p>
    </div>
  );
}

const panelLabelStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "0.5rem",
  fontSize: "var(--fs-label)",
  fontWeight: 700,
  letterSpacing: "0.03em",
  textTransform: "uppercase",
  color: "var(--color-accent-label)",
};

/**
 * Persistent "what's being talked about right now" strip, sitting in-flow
 * directly under the video and updating every ~30s (see
 * useConversationMemory). Tapping it reveals the running summary of the
 * whole call so far.
 *
 * Previously a small floating corner bubble whose one meaningful sentence
 * was truncated to a single ellipsized line — the text now wraps in full,
 * since that sentence is the entire point of the feature.
 */
function ContextBubble({ context, summary }: { context: string; summary: string }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="glass-card fade-in" style={{ padding: "1rem 1.25rem", background: "rgba(6, 11, 24, 0.85)" }}>
      <button
        onClick={() => setExpanded(prev => !prev)}
        aria-expanded={expanded}
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem",
          width: "100%", background: "none", border: "none", padding: 0,
          cursor: "pointer", color: "inherit", font: "inherit", textAlign: "left",
        }}
      >
        <span style={panelLabelStyle}>
          <Sparkles size={16} />
          Right now
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: "0.375rem", fontSize: "var(--fs-label)", color: "var(--color-text-secondary)", flexShrink: 0 }}>
          {expanded ? "Hide" : "More"}
          {expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
        </span>
      </button>

      <p style={{ fontSize: "var(--fs-body)", lineHeight: 1.5, color: "white", margin: "0.5rem 0 0" }}>
        {context || "Listening…"}
      </p>

      {expanded && (
        <p style={{ fontSize: "var(--fs-body)", lineHeight: 1.6, color: "var(--color-text-secondary)", margin: "1rem 0 0", whiteSpace: "pre-wrap" }}>
          {summary || "Nothing summarized yet — keep talking for about 30 seconds."}
        </p>
      )}
    </div>
  );
}

/**
 * One large labelled button that opens the story-style history of PAST calls
 * with this exact other participant (never mixed with anyone else's history
 * — see conversation_memory.py's per-dyad file scoping).
 *
 * Was a small bottom-right bubble that was a clickable <div>: no button
 * semantics, no keyboard access, and no visible cue that it could be opened.
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
    <div className="glass-card fade-in" style={{ background: "rgba(6, 11, 24, 0.85)", display: "flex", flexDirection: "column", maxHeight: expanded ? "32vh" : undefined }}>
      <button
        onClick={handleClick}
        aria-expanded={expanded}
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem",
          width: "100%", background: "none", border: "none", padding: "1rem 1.25rem",
          cursor: "pointer", color: "inherit", font: "inherit", textAlign: "left", flexShrink: 0,
        }}
      >
        <span style={panelLabelStyle}>
          <BookOpen size={16} />
          Our last talks
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: "0.375rem", fontSize: "var(--fs-label)", color: "var(--color-text-secondary)", flexShrink: 0 }}>
          {expanded ? "Hide" : "Open"}
          {expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
        </span>
      </button>

      {expanded && (
        <div style={{ overflowY: "auto", padding: "0 1.25rem 1.25rem" }}>
          {loading && (
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", color: "var(--color-text-secondary)", fontSize: "var(--fs-body)" }}>
              <Loader2 size={18} className="animate-spin" />
              Loading…
            </div>
          )}
          {!loading && entries.length === 0 && (
            <p style={{ fontSize: "var(--fs-body)", color: "var(--color-text-secondary)", margin: 0 }}>
              No past conversations with this person yet.
            </p>
          )}
          {!loading && entries.map((entry, i) => (
            <div key={i} style={{ marginBottom: "1.25rem" }}>
              <p style={{ fontSize: "var(--fs-label)", color: "var(--color-text-muted)", margin: "0 0 0.375rem" }}>
                {entry.timestamp}
              </p>
              <p style={{ fontSize: "var(--fs-body)", lineHeight: 1.6, color: "white", margin: 0 }}>
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
    <div className="container-lg fade-in" style={{ display: "flex", justifyContent: "center", padding: "0.75rem 0 0", flexShrink: 0 }}>
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
          <p key={entry.id} style={{ fontSize: "var(--fs-lead)", lineHeight: 1.45, color: "white", margin: 0 }}>
            <span style={{ fontWeight: 700, color: "var(--color-accent-label)" }}>{entry.name}: </span>
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
