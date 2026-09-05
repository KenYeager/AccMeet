"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { SignalingClient } from "@/lib/websocket";
import { PeerConnectionManager, getLocalMediaStream } from "@/lib/webrtc";
import { LiveCaptioner, isSpeechRecognitionSupported } from "@/lib/liveCaptioner";
import { meetings } from "@/lib/api";
import type {
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
  CaregiverTipPayload,
} from "@/types";

// Long enough for a slower reader to finish the line before it disappears.
const CAPTION_CLEAR_MS = 8000;

export function useWebRTC(
  meetingCode: string,
  currentUserId: string | undefined,
  currentUserName: string | undefined,
  // Fires for every FINAL caption, local or peer — (speakerUserId, text).
  // Read via a ref (see onFinalCaptionRef below) so passing a fresh inline
  // function each render never tears down/restarts the connection effect.
  onFinalCaption?: (fromUserId: string, text: string) => void,
  // Fires when a targeted "caregiver_tip" message arrives from the patient's
  // client — see useConversationMemory, which computes and sends these.
  onCaregiverTip?: (payload: CaregiverTipPayload) => void,
) {
  const router = useRouter();

  // Stable refs for signaling and peer connections (not reactive)
  const signalingRef = useRef<SignalingClient | null>(null);
  const pcManagerRef = useRef<PeerConnectionManager | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);

  // Reactive state
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("connecting");
  const [participants, setParticipants] = useState<RemoteParticipant[]>([]);
  const [remoteStreams, setRemoteStreams] = useState<Map<string, MediaStream>>(new Map());
  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(true);
  const [hasCamera, setHasCamera] = useState(false);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [micError, setMicError] = useState<string | null>(null);
  const [captionsEnabled, setCaptionsEnabled] = useState(false);
  const [localCaption, setLocalCaption] = useState("");

  const captionerRef = useRef<LiveCaptioner | null>(null);
  const localCaptionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const captionTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const onFinalCaptionRef = useRef(onFinalCaption);
  useEffect(() => { onFinalCaptionRef.current = onFinalCaption; }, [onFinalCaption]);

  const onCaregiverTipRef = useRef(onCaregiverTip);
  useEffect(() => { onCaregiverTipRef.current = onCaregiverTip; }, [onCaregiverTip]);

  // -------------------------------------------------------
  // Helper: update a participant's field
  // -------------------------------------------------------
  const updateParticipant = useCallback((userId: string, updates: Partial<RemoteParticipant>) => {
    setParticipants(prev =>
      prev.map(p => p.user_id === userId ? { ...p, ...updates } : p)
    );
  }, []);

  // Clears a participant's caption a few seconds after their last transcript
  // update — mirrors how live captions disappear once someone stops talking.
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

  // -------------------------------------------------------
  // Initialization
  // -------------------------------------------------------
  useEffect(() => {
    if (!currentUserId || !currentUserName || !meetingCode) return;

    let destroyed = false;

    const init = async () => {
      // 1. Get local mic + camera (falls back to mic-only if camera unavailable)
      try {
        const { stream, hasVideo } = await getLocalMediaStream();
        if (destroyed) { stream.getTracks().forEach(t => t.stop()); return; }
        localStreamRef.current = stream;
        setLocalStream(stream);
        setHasCamera(hasVideo);
        setIsCameraOff(!hasVideo);

        // 2. Set up PeerConnectionManager
        const pcManager = new PeerConnectionManager(
          // onRemoteStream
          (userId, stream) => {
            if (destroyed) return;
            setRemoteStreams(prev => new Map(prev).set(userId, stream));
            updateParticipant(userId, { stream });
          },
          // onIceCandidate — relay to peer via signaling
          (userId, candidate) => {
            signalingRef.current?.send("ice_candidate", candidate, userId);
          },
          // onConnectionStateChange
          (userId, state) => {
            console.log(`[Peer ${userId}]: ${state}`);
          }
        );
        pcManager.setLocalStream(stream);
        pcManagerRef.current = pcManager;

        // 3. Connect to signaling server
        const signaling = new SignalingClient();
        signalingRef.current = signaling;

        // room_state — received on initial connect, contains existing participants
        signaling.on("room_state", async (msg: SignalingMessage) => {
          if (destroyed) return;
          const payload = msg.payload as RoomStatePayload;
          const existingPeers = payload.participants;

          // Set initial participant list
          setParticipants(existingPeers.map(p => ({
            user_id: p.user_id,
            user_name: p.user_name,
            isMuted: false,
            isSpeaking: false,
            isCameraOff: false,
          })));

          // Initiate offers to all existing peers
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

        // participant_joined — new peer joined, they will send us an offer
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
            }];
          });
          toast(`${payload.user_name} joined`, { icon: "👋" });
        });

        // participant_left — clean up peer connection and stream
        signaling.on("participant_left", (msg: SignalingMessage) => {
          if (destroyed) return;
          const payload = msg.payload as ParticipantLeftPayload;
          pcManager.closePeer(payload.user_id);
          setRemoteStreams(prev => {
            const next = new Map(prev);
            next.delete(payload.user_id);
            return next;
          });
          setParticipants(prev => prev.filter(p => p.user_id !== payload.user_id));
          toast(`${payload.user_name} left`, { icon: "👋" });
        });

        // offer received — create and send back an answer
        signaling.on("offer", async (msg: SignalingMessage) => {
          if (destroyed) return;
          const offer = msg.payload as WebRTCPayload;
          const fromUserId = msg.from_user_id!;
          try {
            const answer = await pcManager.handleOffer(fromUserId, offer as RTCSessionDescriptionInit);
            signaling.send("answer", answer, fromUserId);
          } catch (e) {
            console.error(`[WebRTC] Failed to handle offer from ${fromUserId}:`, e);
          }
        });

        // answer received — set remote description
        signaling.on("answer", async (msg: SignalingMessage) => {
          if (destroyed) return;
          const answer = msg.payload as WebRTCPayload;
          await pcManager.handleAnswer(msg.from_user_id!, answer as RTCSessionDescriptionInit);
        });

        // ICE candidate received — add to peer connection
        signaling.on("ice_candidate", async (msg: SignalingMessage) => {
          if (destroyed) return;
          const candidate = msg.payload as RTCIceCandidateInit;
          await pcManager.handleIceCandidate(msg.from_user_id!, candidate);
        });

        // mute_status from peers
        signaling.on("mute_status", (msg: SignalingMessage) => {
          if (destroyed) return;
          const payload = msg.payload as MuteStatusPayload;
          updateParticipant(msg.from_user_id!, { isMuted: payload.is_muted });
        });

        // video_status from peers
        signaling.on("video_status", (msg: SignalingMessage) => {
          if (destroyed) return;
          const payload = msg.payload as VideoStatusPayload;
          updateParticipant(msg.from_user_id!, { isCameraOff: payload.is_camera_off });
        });

        // caption from peers — live subtitle text (interim or final)
        signaling.on("caption", (msg: SignalingMessage) => {
          if (destroyed) return;
          const payload = msg.payload as CaptionPayload;
          const fromUserId = msg.from_user_id!;
          console.log("[Captions] received from peer", fromUserId, payload);
          updateParticipant(fromUserId, { caption: payload.text });
          scheduleCaptionClear(fromUserId);
          if (payload.is_final) onFinalCaptionRef.current?.(fromUserId, payload.text);
        });

        // caregiver_tip — targeted, computed on the patient's client and
        // sent straight at this participant's user_id (see useConversationMemory)
        signaling.on("caregiver_tip", (msg: SignalingMessage) => {
          if (destroyed) return;
          onCaregiverTipRef.current?.(msg.payload as CaregiverTipPayload);
        });

        // Connection status
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
        console.error("[WebRTC] Mic error:", err);
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

    // Cleanup on unmount
    return () => {
      destroyed = true;
      signalingRef.current?.disconnect();
      signalingRef.current = null;
      pcManagerRef.current?.closeAll();
      pcManagerRef.current = null;
      localStreamRef.current?.getTracks().forEach(t => t.stop());
      localStreamRef.current = null;
    };
  }, [meetingCode, currentUserId, currentUserName, updateParticipant, scheduleCaptionClear]);

  // Live captions — runs the browser's speech recognition on the local mic
  // and broadcasts transcripts as "caption" signaling messages. Only active
  // while explicitly enabled and unmuted (recognizing a muted mic makes no
  // sense, and it avoids surprising anyone with always-on transcription).
  useEffect(() => {
    console.log("[Captions] effect run", { captionsEnabled, isMuted, hasLocalStream: !!localStream });
    if (!captionsEnabled || isMuted || !localStream) {
      captionerRef.current?.stop();
      captionerRef.current = null;
      setLocalCaption("");
      return;
    }

    const captioner = new LiveCaptioner(
      (text, isFinal) => {
        console.log("[Captions] local result, sending", { text, isFinal, wsOpen: signalingRef.current?.isConnected });
        setLocalCaption(text);
        scheduleLocalCaptionClear();
        signalingRef.current?.send("caption", { text, is_final: isFinal });
        if (isFinal && currentUserId) onFinalCaptionRef.current?.(currentUserId, text);
      },
      (error) => {
        console.warn("[Captions] captioner error", error);
        toast.error(error);
        setCaptionsEnabled(false);
      }
    );
    captionerRef.current = captioner;
    captioner.start();

    return () => {
      captioner.stop();
      captionerRef.current = null;
    };
  }, [captionsEnabled, isMuted, localStream, scheduleLocalCaptionClear]);

  // Handle tab close / navigation away
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

  const toggleCaptions = useCallback(() => {
    setCaptionsEnabled(prev => {
      const next = !prev;
      console.log("[Captions] toggle clicked", { prev, next, supported: isSpeechRecognitionSupported() });
      if (next && !isSpeechRecognitionSupported()) {
        toast.error("Live captions aren't supported in this browser — try Chrome or Edge.");
        return prev;
      }
      return next;
    });
  }, []);

  // Called from useConversationMemory after a chunk response comes back with
  // a repeated-question tip — relayed straight to the non-patient's socket,
  // targeted by user_id (same relay mechanism as offer/answer/ice_candidate).
  const sendCaregiverTip = useCallback((payload: CaregiverTipPayload, targetUserId: string) => {
    signalingRef.current?.send("caregiver_tip", payload, targetUserId);
  }, []);

  const leaveRoom = useCallback(async () => {
    signalingRef.current?.disconnect();
    pcManagerRef.current?.closeAll();
    localStreamRef.current?.getTracks().forEach(t => t.stop());
    captionerRef.current?.stop();
    captionerRef.current = null;
    if (currentUserId) {
      try {
        await meetings.leave(meetingCode, currentUserId);
      } catch {}
    }
    router.push("/dashboard");
  }, [meetingCode, currentUserId, router]);

  return {
    localStream,
    remoteStreams,
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
  };
}
