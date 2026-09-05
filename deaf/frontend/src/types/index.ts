// =========================================================
// Shared TypeScript types for DeafMeet
// =========================================================

export interface Meeting {
  id: string;
  meeting_code: string;
  host_id: string;
  host_name: string;
  status: "waiting" | "active" | "ended";
  created_at: string;
}

export interface Participant {
  id: string;
  meeting_id: string;
  user_id: string;
  user_name: string;
  joined_at: string;
  left_at: string | null;
}

export interface MeetingWithParticipants {
  meeting: Meeting;
  participants: Participant[];
}

// =========================================================
// WebSocket signaling message types
// =========================================================

export interface RoomStatePayload {
  participants: Array<{ user_id: string; user_name: string }>;
  your_user_id: string;
  your_user_name: string;
}

export interface ParticipantJoinedPayload {
  user_id: string;
  user_name: string;
}

export interface ParticipantLeftPayload {
  user_id: string;
  user_name: string;
}

export interface MuteStatusPayload {
  is_muted: boolean;
}

export interface VideoStatusPayload {
  is_camera_off: boolean;
}

export interface AslGif {
  word: string;
  gif?: string | null;
}

export interface CaptionPayload {
  text: string;
  is_final: boolean;
  asl_tokens?: string[];
  asl_gifs?: AslGif[];
}

export interface WebRTCPayload {
  sdp?: string;
  type?: RTCSdpType;
  candidate?: string;
  sdpMLineIndex?: number | null;
  sdpMid?: string | null;
}

export type SignalingMessageType =
  | "room_state"
  | "participant_joined"
  | "participant_left"
  | "offer"
  | "answer"
  | "ice_candidate"
  | "mute_status"
  | "video_status"
  | "caption"
  | "stt_offer"
  | "stt_answer"
  | "stt_ice_candidate"
  | "error";

// SDP exchange for the client's dedicated browser-to-server audio connection
// (separate from the browser-to-browser mesh `WebRTCPayload` above) — used
// only to carry audio to the backend for server-side transcription.
export interface SttSdpPayload {
  sdp: string;
  type: RTCSdpType;
}

export interface SignalingMessage {
  type: SignalingMessageType;
  from_user_id?: string;
  from_user_name?: string;
  target_user_id?: string;
  payload: RoomStatePayload | ParticipantJoinedPayload | ParticipantLeftPayload | MuteStatusPayload | VideoStatusPayload | CaptionPayload | WebRTCPayload | SttSdpPayload | { message: string };
}

// =========================================================
// UI State
// =========================================================

export interface RemoteParticipant {
  user_id: string;
  user_name: string;
  isMuted: boolean;
  isSpeaking: boolean;
  isCameraOff: boolean;
  stream?: MediaStream;
  caption?: string;
  captionHistory?: CaptionEntry[];
}

export interface CaptionEntry {
  id: string;
  text: string;
  isFinal: boolean;
  timestamp: number;
  aslGifs?: AslGif[];
}

export type ConnectionStatus = "connecting" | "connected" | "disconnected" | "error";

export interface AslRecognitionEntry {
  id: string;
  word: string;
  confidence: number;
  timestamp: number;
  participantName: string;
}

