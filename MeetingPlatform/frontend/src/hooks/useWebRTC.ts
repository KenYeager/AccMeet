"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { SignalingClient } from "@/lib/websocket";
import { PeerConnectionManager, getLocalMediaStream } from "@/lib/webrtc";
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
} from "@/types";

export function useWebRTC(meetingCode: string, currentUserId: string | undefined, currentUserName: string | undefined) {
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

  // -------------------------------------------------------
  // Helper: update a participant's field
  // -------------------------------------------------------
  const updateParticipant = useCallback((userId: string, updates: Partial<RemoteParticipant>) => {
    setParticipants(prev =>
      prev.map(p => p.user_id === userId ? { ...p, ...updates } : p)
    );
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
  }, [meetingCode, currentUserId, currentUserName, updateParticipant]);

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

  const leaveRoom = useCallback(async () => {
    signalingRef.current?.disconnect();
    pcManagerRef.current?.closeAll();
    localStreamRef.current?.getTracks().forEach(t => t.stop());
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
    toggleMute,
    toggleCamera,
    leaveRoom,
  };
}
