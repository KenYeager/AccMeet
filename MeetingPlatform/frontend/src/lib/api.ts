import type {
  MeetingWithParticipants,
  Participant,
  RagIngestItem,
  RagIngestResponse,
  RagQueryResponse,
  ConversationChunkResponse,
  ConversationHistoryEntry,
  InsightsReport,
} from "@/types";

const API_BASE = "/api"; // Proxied by Next.js rewrites to backend

class ApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${url}`, {
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
    ...options,
  });

  if (!response.ok) {
    let detail = `HTTP ${response.status}`;
    try {
      const body = await response.json();
      detail = body.detail || detail;
    } catch {}
    throw new ApiError(response.status, detail);
  }

  // 204 No Content
  if (response.status === 204) {
    return undefined as T;
  }

  return response.json();
}

export interface Identity {
  user_id: string;
  user_name: string;
}

// =========================================================
// Meeting endpoints — identity is self-declared (no auth), sent
// with each call rather than resolved from a session cookie.
// =========================================================
export const meetings = {
  create: (identity: Identity) =>
    request<{ id: string; meeting_code: string; host_id: string; host_name: string; status: string; created_at: string }>("/meetings", {
      method: "POST",
      body: JSON.stringify(identity),
    }),

  get: (code: string) =>
    request<MeetingWithParticipants>(`/meetings/${code}`),

  join: (code: string, identity: Identity) =>
    request<Participant>(`/meetings/${code}/join`, { method: "POST", body: JSON.stringify(identity) }),

  leave: (code: string, userId: string) =>
    request<void>(`/meetings/${code}/leave`, { method: "POST", body: JSON.stringify({ user_id: userId }) }),

  participants: (code: string) =>
    request<Participant[]>(`/meetings/${code}/participants`),
};

// =========================================================
// RAG endpoints — proxied by the MeetingPlatform backend to
// the standalone rag service.
// =========================================================
export const rag = {
  ingest: (items: RagIngestItem[]) =>
    request<RagIngestResponse>("/rag/ingest", { method: "POST", body: JSON.stringify({ items }) }),

  query: (chunk: string) =>
    request<RagQueryResponse>("/rag/query", { method: "POST", body: JSON.stringify({ chunk }) }),
};

// =========================================================
// Automated LangGraph orchestrator — replaces the old manual
// ingestion/retrieval toggle buttons. One call per ~30s chunk of a
// participant's own speech; the graph itself decides whether to store
// it as lore, look something up (patient-only), and/or schedule a
// calendar event. See rag/backend/graph.py.
// =========================================================
export const orchestrator = {
  // `call` identifies which conversation this chunk belongs to, so the
  // log_speech_observation tool can attach what it notices to the right call
  // record. Omitted by non-patient clients, which record nothing.
  process: (
    text: string,
    isPatient: boolean,
    call?: { patientId: string; otherId: string; otherName: string; meetingCode: string },
  ) =>
    request<RagQueryResponse & { actions: { tool: string; result: string }[] }>("/rag/orchestrate", {
      method: "POST",
      body: JSON.stringify({
        text,
        is_patient: isPatient,
        patient_id: call?.patientId,
        other_id: call?.otherId,
        other_name: call?.otherName,
        meeting_code: call?.meetingCode,
      }),
    }),
};

// =========================================================
// Conversation memory — patient-only "context bubble" / "history
// bubble" feature. Proxied through to rag/backend's per-dyad .txt
// file storage (not a database — see conversation_memory.py).
// =========================================================
export const conversation = {
  sendChunk: (patientId: string, otherId: string, otherName: string, meetingCode: string, text: string, patientName?: string) =>
    request<ConversationChunkResponse>("/conversation/chunk", {
      method: "POST",
      body: JSON.stringify({
        patient_id: patientId,
        patient_name: patientName,
        other_id: otherId,
        other_name: otherName,
        meeting_code: meetingCode,
        text,
      }),
    }),

  finalize: (patientId: string, otherId: string, otherName: string, meetingCode: string) =>
    request<{ status: string }>("/conversation/finalize", {
      method: "POST",
      body: JSON.stringify({
        patient_id: patientId,
        other_id: otherId,
        other_name: otherName,
        meeting_code: meetingCode,
      }),
    }),

  getHistory: (patientId: string, otherId: string, otherName: string) =>
    request<{ entries: ConversationHistoryEntry[] }>(
      `/conversation/history?patient_id=${encodeURIComponent(patientId)}&other_id=${encodeURIComponent(otherId)}&other_name=${encodeURIComponent(otherName)}`
    ),
};

// =========================================================
// Speech insights — the caregiver-only report. Surfaced only on
// a non-patient device (see app/insights/page.tsx).
// =========================================================
export const insights = {
  getReport: (patientId: string, otherId: string, otherName: string) =>
    request<InsightsReport>(
      `/conversation/insights?patient_id=${encodeURIComponent(patientId)}&other_id=${encodeURIComponent(otherId)}&other_name=${encodeURIComponent(otherName)}`
    ),
};

export { ApiError };
