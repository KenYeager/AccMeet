"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { conversation } from "@/lib/api";
import type { ConversationHistoryEntry } from "@/types";

const CHUNK_INTERVAL_MS = 30_000;

interface OtherParticipant {
  user_id: string;
  user_name: string;
}

/**
 * Drives the patient-only "context bubble" / "history bubble" feature.
 * Entirely a no-op when `isPatient` is false — the non-patient side of a
 * call never buffers, summarizes, or stores anything.
 *
 * Storage is intentionally not a database: rag/backend keeps one plain .txt
 * file per (patient, other-person) pair, so history for different people
 * never mixes — see rag/backend/conversation_memory.py.
 */
export function useConversationMemory(
  meetingCode: string,
  isPatient: boolean,
  patientId: string | undefined,
  otherParticipant: OtherParticipant | null,
) {
  const [currentContext, setCurrentContext] = useState("");
  const [sessionSummary, setSessionSummary] = useState("");
  const [history, setHistory] = useState<ConversationHistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Rolling buffer of "Speaker: text" lines, flushed every 30s. A ref (not
  // state) because it's written on every final caption but only ever read
  // from the interval callback — no re-render needed for the buffer itself.
  const bufferRef = useRef<string[]>([]);
  const otherRef = useRef<OtherParticipant | null>(otherParticipant);
  useEffect(() => { otherRef.current = otherParticipant; }, [otherParticipant]);

  // Called from useWebRTC's onFinalCaption for BOTH the patient's own final
  // captions and the one other participant's relayed final captions — that's
  // how we capture both sides of the dialogue without a second WS subscription.
  const addUtterance = useCallback((fromUserId: string, text: string) => {
    if (!isPatient || !patientId || !text.trim()) return;
    const label = fromUserId === patientId ? "Patient" : (otherRef.current?.user_name ?? "Other");
    bufferRef.current.push(`${label}: ${text.trim()}`);
  }, [isPatient, patientId]);

  // Periodic flush — only runs at all while isPatient, matching the "fully
  // automatic, no manual toggle" decision (independent of the existing
  // manual RAG ingest/retrieve buttons).
  useEffect(() => {
    if (!isPatient || !patientId) return;

    const interval = setInterval(() => {
      const other = otherRef.current;
      if (!other || bufferRef.current.length === 0) return;

      const text = bufferRef.current.join("\n");
      bufferRef.current = [];

      conversation.sendChunk(patientId, other.user_id, other.user_name, meetingCode, text)
        .then(result => {
          setCurrentContext(result.current_context);
          setSessionSummary(result.session_summary);
        })
        .catch(() => {
          console.warn("[ConversationMemory] chunk summarization failed");
        });
    }, CHUNK_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [isPatient, patientId, meetingCode]);

  // Called before leaving the call — condenses this session's lines into a
  // paragraph and appends it to the persistent per-dyad file. See the
  // documented limitation: an abrupt tab close skips this (acceptable for
  // hackathon scope; a robust version would trigger it server-side on WS
  // disconnect instead).
  const finalize = useCallback(async () => {
    const other = otherRef.current;
    if (!isPatient || !patientId || !other) return;
    try {
      await conversation.finalize(patientId, other.user_id, other.user_name, meetingCode);
    } catch {
      console.warn("[ConversationMemory] finalize failed");
    }
  }, [isPatient, patientId, meetingCode]);

  const fetchHistory = useCallback(async () => {
    const other = otherRef.current;
    if (!patientId || !other) return;
    setHistoryLoading(true);
    try {
      const result = await conversation.getHistory(patientId, other.user_id, other.user_name);
      setHistory(result.entries);
    } catch {
      console.warn("[ConversationMemory] history fetch failed");
    } finally {
      setHistoryLoading(false);
    }
  }, [patientId]);

  return { currentContext, sessionSummary, history, historyLoading, addUtterance, finalize, fetchHistory };
}
