import type { MeetingWithParticipants, Participant, RagIngestItem, RagIngestResponse, RagQueryResponse } from "@/types";

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

export { ApiError };
