// =========================================================
// Shared TypeScript types
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

export interface CaptionPayload {
  text: string;
  is_final: boolean;
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
  | "error";

export interface SignalingMessage {
  type: SignalingMessageType;
  from_user_id?: string;
  from_user_name?: string;
  target_user_id?: string;
  payload: RoomStatePayload | ParticipantJoinedPayload | ParticipantLeftPayload | MuteStatusPayload | VideoStatusPayload | CaptionPayload | WebRTCPayload | { message: string };
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
}

export type ConnectionStatus = "connecting" | "connected" | "disconnected" | "error";

// =========================================================
// RAG / HUD — proxied through the MeetingPlatform backend to
// the standalone rag service (see lib/api.ts's `rag` client)
// =========================================================

export interface RagIngestItem {
  text: string;
  category?: string;
  entity_name?: string;
}

export interface RagIngestResponse {
  status: string;
  inserted: number;
}

export interface RagQueryResponse {
  hud_triggered: boolean;
  tool_name: string | null;
  query: string | null;
  hud_card_data: string | null;
  assistant_response: string;
}
