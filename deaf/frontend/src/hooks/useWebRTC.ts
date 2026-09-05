"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { SignalingClient } from "@/lib/websocket";
import { PeerConnectionManager, getLocalMediaStream } from "@/lib/webrtc";
import { SttStream } from "@/lib/sttStream";
import { meetings } from "@/lib/api";
import type {
  CaptionEntry,
  ConnectionStatus,
  ParticipantJoinedPayload,
  ParticipantLeftPayload,
  RemoteParticipant,
  RoomStatePayload,
  SignalingMessage,
  WebRTCPayload,
  MuteStatusPayload,
  VideoStatusPayload,
  CaptionPayload,
} from "@/types";

// Live caption stays visible for 6 seconds (longer than MeetingPlatform — more time to read)
const CAPTION_CLEAR_MS = 6000;
// Maximum entries kept in caption history per participant
const MAX_HISTORY = 50;

export interface LocalCaptionEntry {
  id: string;
  text: string;
  isFinal: boolean;
  timestamp: number;
}

export function useWebRTC(
  meetingCode: string,
  currentUserId: string | undefined,
  currentUserName: string | undefined,
) {
  const router = useRouter();

  const signalingRef = useRef<SignalingClient | null>(null);
  const pcManagerRef = useRef<PeerConnectionManager | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);

  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("connecting");
  const [participants, setParticipants] = useState<RemoteParticipant[]>([]);
  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(true);
  const [hasCamera, setHasCamera] = useState(false);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [micError, setMicError] = useState<string | null>(null);

  // Caption state — always on for deaf users
  const [localCaption, setLocalCaption] = useState("");
  const [localCaptionHistory, setLocalCaptionHistory] = useState<LocalCaptionEntry[]>([]);

  const sttStreamRef = useRef<SttStream | null>(null);
  const localCaptionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const captionTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // -------------------------------------------------------
  // Participant helpers
  // -------------------------------------------------------
  const updateParticipant = useCallback((userId: string, updates: Partial<RemoteParticipant>) => {
    setParticipants(prev =>
      prev.map(p => p.user_id === userId ? { ...p, ...updates } : p)
    );
  }, []);

  const appendCaptionHistory = useCallback((userId: string, entry: CaptionEntry) => {
    setParticipants(prev =>
      prev.map(p => {
        if (p.user_id !== userId) return p;
        const existing = p.captionHistory || [];
        // Replace the last interim if it exists, otherwise append
        const last = existing[existing.length - 1];
        let next: CaptionEntry[];
        if (last && !last.isFinal && !entry.isFinal) {
          // Update rolling interim
          next = [...existing.slice(0, -1), entry];
        } else if (last && !last.isFinal && entry.isFinal) {
          // Finalize it
          next = [...existing.slice(0, -1), entry];
        } else {
          next = [...existing, entry];
        }
        // Trim to max
        if (next.length > MAX_HISTORY) next = next.slice(next.length - MAX_HISTORY);
        return { ...p, captionHistory: next };
      })
    );
  }, []);

  const scheduleCaptionClear = useCallback((userId: string) => {
    const timers = captionTimersRef.current;
    const existing = timers.get(userId);
    if (existing) clearTimeout(existing);
    timers.set(userId, setTimeout(() => {
      updateParticipant(userId, { caption: "" });
      timers.delete(userId);
    }, CAPTION_CLEAR_MS));
  }, [updateParticipant]);

  const scheduleLocalCaptionClear = useCallback(() => {
    if (localCaptionTimerRef.current) clearTimeout(localCaptionTimerRef.current);
    localCaptionTimerRef.current = setTimeout(() => setLocalCaption(""), CAPTION_CLEAR_MS);
  }, []);

  const appendLocalCaptionHistory = useCallback((text: string, isFinal: boolean) => {
    setLocalCaptionHistory(prev => {
      const last = prev[prev.length - 1];
      const entry: LocalCaptionEntry = { id: `self-${Date.now()}`, text, isFinal, timestamp: Date.now() };
      let next: LocalCaptionEntry[];
      if (last && !last.isFinal) {
        // Replace rolling interim with latest
        next = [...prev.slice(0, -1), entry];
      } else {
        next = [...prev, entry];
      }
      if (next.length > MAX_HISTORY) next = next.slice(next.length - MAX_HISTORY);
      return next;
    });
  }, []);

  // -------------------------------------------------------
  // Initialization
  // -------------------------------------------------------
  useEffect(() => {
    if (!currentUserId || !currentUserName || !meetingCode) return;

    let destroyed = false;

    const init = async () => {
      try {
        const { stream, hasVideo } = await getLocalMediaStream();
        if (destroyed) { stream.getTracks().forEach(t => t.stop()); return; }
        localStreamRef.current = stream;
        setLocalStream(stream);
        setHasCamera(hasVideo);
        setIsCameraOff(!hasVideo);

        const pcManager = new PeerConnectionManager(
          (userId, stream) => {
            if (destroyed) return;
            updateParticipant(userId, { stream });
          },
          (userId, candidate) => {
            signalingRef.current?.send("ice_candidate", candidate, userId);
          },
          (userId, state) => {
            console.log(`[Peer ${userId}]: ${state}`);
          }
        );
        pcManager.setLocalStream(stream);
        pcManagerRef.current = pcManager;

        const signaling = new SignalingClient();
        signalingRef.current = signaling;

        signaling.on("room_state", async (msg: SignalingMessage) => {
          if (destroyed) return;
          const payload = msg.payload as RoomStatePayload;
          const existingPeers = payload.participants;

          setParticipants(existingPeers.map(p => ({
            user_id: p.user_id,
            user_name: p.user_name,
            isMuted: false,
            isSpeaking: false,
            isCameraOff: false,
            captionHistory: [],
          })));

          for (const peer of existingPeers) {
            if (destroyed) break;
            try {
              const offer = await pcManager.createOffer(peer.user_id);
              signaling.send("offer", offer, peer.user_id);
            } catch (e) {
              console.error(`[WebRTC] Failed to create offer for ${peer.user_id}:`, e);
            }
          }

          setConnectionStatus("connected");
        });

        signaling.on("participant_joined", (msg: SignalingMessage) => {
          if (destroyed) return;
          const payload = msg.payload as ParticipantJoinedPayload;
          setParticipants(prev => {
            if (prev.find(p => p.user_id === payload.user_id)) return prev;
            return [...prev, {
              user_id: payload.user_id,
              user_name: payload.user_name,
              isMuted: false,
              isSpeaking: false,
              isCameraOff: false,
              captionHistory: [],
            }];
          });
          toast(`${payload.user_name} joined`, { icon: "👋" });
        });

        signaling.on("participant_left", (msg: SignalingMessage) => {
          if (destroyed) return;
          const payload = msg.payload as ParticipantLeftPayload;
          pcManager.closePeer(payload.user_id);
          setParticipants(prev => prev.filter(p => p.user_id !== payload.user_id));
          toast(`${payload.user_name} left`, { icon: "👋" });
        });

        signaling.on("offer", async (msg: SignalingMessage) => {
          if (destroyed) return;
          const offer = msg.payload as WebRTCPayload;
          const fromUserId = msg.from_user_id!;
          try {
            const answer = await pcManager.handleOffer(fromUserId, offer as RTCSessionDescriptionInit);
            signaling.send("answer", answer, fromUserId);
          } catch (e) {
            console.error(`[WebRTC] Failed to handle offer:`, e);
          }
        });

        signaling.on("answer", async (msg: SignalingMessage) => {
          if (destroyed) return;
          const answer = msg.payload as WebRTCPayload;
          await pcManager.handleAnswer(msg.from_user_id!, answer as RTCSessionDescriptionInit);
        });

        signaling.on("ice_candidate", async (msg: SignalingMessage) => {
          if (destroyed) return;
          const candidate = msg.payload as RTCIceCandidateInit;
          await pcManager.handleIceCandidate(msg.from_user_id!, candidate);
        });

        signaling.on("mute_status", (msg: SignalingMessage) => {
          if (destroyed) return;
          const payload = msg.payload as MuteStatusPayload;
          updateParticipant(msg.from_user_id!, { isMuted: payload.is_muted });
        });

        signaling.on("video_status", (msg: SignalingMessage) => {
          if (destroyed) return;
          const payload = msg.payload as VideoStatusPayload;
          updateParticipant(msg.from_user_id!, { isCameraOff: payload.is_camera_off });
        });

        // Captions now originate entirely server-side (see stt_peer_service.py)
        // — both "my own speech" and "a peer's speech" arrive over this same
        // broadcast, told apart only by from_user_id. The old direct
        // LiveCaptioner callback that used to populate localCaption locally
        // no longer exists.
        signaling.on("caption", (msg: SignalingMessage) => {
          if (destroyed) return;
          const payload = msg.payload as CaptionPayload;
          const fromUserId = msg.from_user_id!;

          if (fromUserId === currentUserId) {
            setLocalCaption(payload.text);
            scheduleLocalCaptionClear();
            appendLocalCaptionHistory(payload.text, payload.is_final);
            return;
          }

          updateParticipant(fromUserId, { caption: payload.text });
          appendCaptionHistory(fromUserId, {
            id: `${fromUserId}-${Date.now()}`,
            text: payload.text,
            isFinal: payload.is_final,
            timestamp: Date.now(),
          });
          scheduleCaptionClear(fromUserId);
        });

        signaling.on("open" as any, () => setConnectionStatus("connected"));
        signaling.on("close" as any, () => {
          if (!destroyed) setConnectionStatus("disconnected");
        });
        signaling.on("error" as any, () => {
          if (!destroyed) setConnectionStatus("error");
        });

        signaling.connect(meetingCode, currentUserId, currentUserName);

      } catch (err: any) {
        if (destroyed) return;
        if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
          setMicError("Microphone access denied. Please allow microphone access in your browser settings.");
        } else if (err.name === "NotFoundError") {
          setMicError("No microphone found. Please connect a microphone and try again.");
        } else {
          setMicError("Could not access microphone. Please check your device settings.");
        }
        setConnectionStatus("error");
      }
    };

    init();

    return () => {
      destroyed = true;
      signalingRef.current?.disconnect();
      signalingRef.current = null;
      pcManagerRef.current?.closeAll();
      pcManagerRef.current = null;
      localStreamRef.current?.getTracks().forEach(t => t.stop());
      localStreamRef.current = null;
    };
  }, [meetingCode, currentUserId, currentUserName, updateParticipant, appendCaptionHistory, scheduleCaptionClear, appendLocalCaptionHistory, scheduleLocalCaptionClear]);

  // -------------------------------------------------------
  // Auto-start server-side captioning once we have a live local stream and
  // an open signaling connection. Keeping this in a separate useEffect
  // (keyed on localStream) avoids the React StrictMode double-invoke race
  // where the async init() cleanup fires before this code is reached.
  // -------------------------------------------------------
  useEffect(() => {
    if (!localStream || !signalingRef.current) return;
    if (!localStream.getAudioTracks().length) {
      console.warn("[Captions] No audio tracks — STT stream not started");
      return;
    }

    console.log("[Captions] Starting server-side STT stream");
    const sttStream = new SttStream(signalingRef.current);
    sttStreamRef.current = sttStream;
    sttStream.start(localStream).catch(err => {
      console.error("[Captions] Failed to start STT stream:", err);
      toast.error("Live captions unavailable — could not connect to caption service");
    });

    return () => {
      console.log("[Captions] Stopping STT stream");
      sttStreamRef.current?.stop();
      sttStreamRef.current = null;
    };
  }, [localStream]);

  // Handle tab close
  useEffect(() => {
    if (!currentUserId) return;
    const handleBeforeUnload = () => {
      meetings.leave(meetingCode, currentUserId).catch(() => {});
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [meetingCode, currentUserId]);

  // -------------------------------------------------------
  // Actions
  // -------------------------------------------------------
  const toggleMute = useCallback(() => {
    const pcManager = pcManagerRef.current;
    if (!pcManager) return;
    const nowMuted = pcManager.toggleMute();
    setIsMuted(nowMuted);
    signalingRef.current?.send("mute_status", { is_muted: nowMuted });
  }, []);

  const toggleCamera = useCallback(() => {
    const pcManager = pcManagerRef.current;
    if (!pcManager || !pcManager.hasVideo) return;
    const nowOff = pcManager.toggleCamera();
    setIsCameraOff(nowOff);
    signalingRef.current?.send("video_status", { is_camera_off: nowOff });
  }, []);

  const leaveRoom = useCallback(async () => {
    sttStreamRef.current?.stop();
    sttStreamRef.current = null;
    signalingRef.current?.disconnect();
    pcManagerRef.current?.closeAll();
    localStreamRef.current?.getTracks().forEach(t => t.stop());
    if (currentUserId) {
      try { await meetings.leave(meetingCode, currentUserId); } catch {}
    }
    router.push("/dashboard");
  }, [meetingCode, currentUserId, router]);

  // Manually tears down and re-offers the server-side STT connection — a
  // recovery action for when captions silently stop (e.g. the backend peer
  // connection died without the client noticing).
  const restartCaptions = useCallback(() => {
    sttStreamRef.current?.stop();
    if (localStreamRef.current && signalingRef.current) {
      const sttStream = new SttStream(signalingRef.current);
      sttStreamRef.current = sttStream;
      sttStream.start(localStreamRef.current);
      toast.success("Captions restarted");
    } else {
      toast("Starting captions...");
    }
  }, []);

  const sendManualCaption = useCallback((text: string) => {
    if (!text.trim()) return;
    const entry: LocalCaptionEntry = {
      id: `self-${Date.now()}`,
      text: text.trim(),
      isFinal: true,
      timestamp: Date.now(),
    };
    setLocalCaption(text.trim());
    scheduleLocalCaptionClear();
    setLocalCaptionHistory(prev => {
      const next = [...prev, entry];
      if (next.length > MAX_HISTORY) return next.slice(next.length - MAX_HISTORY);
      return next;
    });
    signalingRef.current?.send("caption", { text: text.trim(), is_final: true });
  }, [scheduleLocalCaptionClear]);

  return {
    localStream,
    participants,
    isMuted,
    isCameraOff,
    hasCamera,
    connectionStatus,
    micError,
    localCaption,
    localCaptionHistory,
    toggleMute,
    toggleCamera,
    leaveRoom,
    restartCaptions,
    sendManualCaption,
  };
}
