export const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

// Mesh topology means every peer uploads to every other peer — cap per-stream
// video bitrate so a full room doesn't saturate uplink/CPU.
const MAX_VIDEO_BITRATE_BPS = 300_000;

const AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};

const VIDEO_CONSTRAINTS: MediaTrackConstraints = {
  width: { ideal: 640 },
  height: { ideal: 360 },
  frameRate: { max: 20 },
};

export interface LocalMedia {
  stream: MediaStream;
  hasVideo: boolean;
}

/**
 * Requests mic + camera together. If the camera is unavailable/denied but the
 * mic isn't, falls back to audio-only rather than failing the whole call —
 * getUserMedia rejects the combined request if *either* device fails.
 */
export async function getLocalMediaStream(): Promise<LocalMedia> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: AUDIO_CONSTRAINTS,
      video: VIDEO_CONSTRAINTS,
    });
    return { stream, hasVideo: true };
  } catch {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: AUDIO_CONSTRAINTS,
      video: false,
    });
    return { stream, hasVideo: false };
  }
}

type OnRemoteStreamCallback = (userId: string, stream: MediaStream) => void;
type OnIceCandidateCallback = (userId: string, candidate: RTCIceCandidateInit) => void;
type OnConnectionStateChange = (userId: string, state: RTCPeerConnectionState) => void;

export class PeerConnectionManager {
  private peers: Map<string, RTCPeerConnection> = new Map();
  private localStream: MediaStream | null = null;

  constructor(
    private onRemoteStream: OnRemoteStreamCallback,
    private onIceCandidate: OnIceCandidateCallback,
    private onConnectionStateChange?: OnConnectionStateChange,
  ) {}

  setLocalStream(stream: MediaStream): void {
    this.localStream = stream;
    // Add local tracks to any already-existing peer connections
    for (const [userId, pc] of this.peers) {
      this._addLocalTracks(pc);
    }
  }

  private _addLocalTracks(pc: RTCPeerConnection): void {
    if (!this.localStream) return;
    const existingSenders = pc.getSenders().map(s => s.track);
    for (const track of this.localStream.getTracks()) {
      if (existingSenders.includes(track)) continue;
      const sender = pc.addTrack(track, this.localStream);
      if (track.kind === "video") this._capVideoBitrate(sender);
    }
  }

  private _capVideoBitrate(sender: RTCRtpSender): void {
    const params = sender.getParameters();
    if (!params.encodings?.length) params.encodings = [{}];
    params.encodings[0].maxBitrate = MAX_VIDEO_BITRATE_BPS;
    // Some browsers reject setParameters before the first negotiation —
    // harmless to skip the cap in that case, video just runs uncapped.
    sender.setParameters(params).catch(() => {});
  }

  private _createPeerConnection(remoteUserId: string): RTCPeerConnection {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    // Add local audio tracks
    this._addLocalTracks(pc);

    // Handle incoming remote audio stream
    pc.ontrack = (event) => {
      const [remoteStream] = event.streams;
      if (remoteStream) {
        this.onRemoteStream(remoteUserId, remoteStream);
      }
    };

    // Forward ICE candidates to signaling server
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.onIceCandidate(remoteUserId, event.candidate.toJSON());
      }
    };

    // Monitor connection state
    pc.onconnectionstatechange = () => {
      console.log(`[WebRTC] ${remoteUserId}: ${pc.connectionState}`);
      this.onConnectionStateChange?.(remoteUserId, pc.connectionState);

      if (pc.connectionState === "failed") {
        // Attempt ICE restart
        pc.restartIce();
      }
    };

    this.peers.set(remoteUserId, pc);
    return pc;
  }

  /**
   * Called when WE initiate a connection to a new peer (they joined after us).
   * Returns the SDP offer to send via signaling.
   */
  async createOffer(remoteUserId: string): Promise<RTCSessionDescriptionInit> {
    const pc = this._createPeerConnection(remoteUserId);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    return offer;
  }

  /**
   * Called when we receive an offer from a peer (they joined before us / initiated).
   * Returns the SDP answer to send back via signaling.
   */
  async handleOffer(
    remoteUserId: string,
    offer: RTCSessionDescriptionInit
  ): Promise<RTCSessionDescriptionInit> {
    const pc = this.peers.get(remoteUserId) || this._createPeerConnection(remoteUserId);
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    return answer;
  }

  /**
   * Called when we receive an answer from a peer we sent an offer to.
   */
  async handleAnswer(remoteUserId: string, answer: RTCSessionDescriptionInit): Promise<void> {
    const pc = this.peers.get(remoteUserId);
    if (!pc) {
      console.warn(`[WebRTC] No peer connection for ${remoteUserId}`);
      return;
    }
    if (pc.signalingState === "stable") return; // Already set
    await pc.setRemoteDescription(new RTCSessionDescription(answer));
  }

  /**
   * Called when we receive an ICE candidate from a peer.
   */
  async handleIceCandidate(remoteUserId: string, candidate: RTCIceCandidateInit): Promise<void> {
    const pc = this.peers.get(remoteUserId);
    if (!pc) return;
    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (e) {
      console.warn("[WebRTC] Failed to add ICE candidate:", e);
    }
  }

  closePeer(remoteUserId: string): void {
    const pc = this.peers.get(remoteUserId);
    if (pc) {
      pc.close();
      this.peers.delete(remoteUserId);
    }
  }

  closeAll(): void {
    for (const [userId, pc] of this.peers) {
      pc.close();
    }
    this.peers.clear();

    if (this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
      this.localStream = null;
    }
  }

  toggleMute(): boolean {
    if (!this.localStream) return true;
    const audioTrack = this.localStream.getAudioTracks()[0];
    if (!audioTrack) return true;
    audioTrack.enabled = !audioTrack.enabled;
    return !audioTrack.enabled; // Returns true if NOW muted
  }

  get isMuted(): boolean {
    if (!this.localStream) return true;
    const audioTrack = this.localStream.getAudioTracks()[0];
    return audioTrack ? !audioTrack.enabled : true;
  }

  /** Toggles the local camera track's enabled state (no renegotiation needed). */
  toggleCamera(): boolean {
    const videoTrack = this.localStream?.getVideoTracks()[0];
    if (!videoTrack) return true;
    videoTrack.enabled = !videoTrack.enabled;
    return !videoTrack.enabled; // Returns true if NOW off
  }

  get isCameraOff(): boolean {
    const videoTrack = this.localStream?.getVideoTracks()[0];
    return videoTrack ? !videoTrack.enabled : true;
  }

  get hasVideo(): boolean {
    return !!this.localStream?.getVideoTracks().length;
  }

  hasPeer(userId: string): boolean {
    return this.peers.has(userId);
  }
}
