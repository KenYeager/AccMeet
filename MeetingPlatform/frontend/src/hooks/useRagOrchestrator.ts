"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { orchestrator } from "@/lib/api";
import type { RagQueryResponse } from "@/types";

const CHUNK_INTERVAL_MS = 30_000;

/**
 * Drives the automatic LangGraph orchestrator — replaces the old manual
 * ingestion/retrieval toggle buttons. Runs for EVERY participant (not just
 * the patient), each buffering only their OWN final captions and flushing
 * every ~30s. The backend graph itself decides whether to store lore,
 * schedule a calendar event, and/or (patient-only, enforced server-side by
 * which graph variant gets invoked) look something up for the HUD.
 *
 * Separate from useConversationMemory's own 30s timer — that one buffers
 * BOTH sides of a dyad's dialogue for the context/history bubbles; this one
 * buffers only this client's own speech for the global lore store. They
 * happen to share a cadence but serve unrelated concerns.
 */
export function useRagOrchestrator(
  isPatient: boolean,
  currentUserId: string | undefined,
  meetingCode?: string,
  otherParticipant?: { user_id: string; user_name: string } | null,
) {
  const [hudCard, setHudCard] = useState<RagQueryResponse | null>(null);
  const [hudLoading, setHudLoading] = useState(false);

  const bufferRef = useRef<string[]>([]);
  // Read from a ref inside the interval so the other participant arriving
  // mid-call doesn't tear down and restart the 30s timer.
  const otherRef = useRef(otherParticipant);
  useEffect(() => { otherRef.current = otherParticipant; }, [otherParticipant]);

  // Called from useWebRTC's onFinalCaption for EVERY final caption (local or
  // peer) — only buffers when it's this client's own speech, so nobody ever
  // double-submits a sentence (mirrors the old ingestion-only-local pattern).
  const addUtterance = useCallback((fromUserId: string, text: string) => {
    if (!currentUserId || fromUserId !== currentUserId || !text.trim()) return;
    bufferRef.current.push(text.trim());
  }, [currentUserId]);

  useEffect(() => {
    if (!currentUserId) return;

    const interval = setInterval(() => {
      if (bufferRef.current.length === 0) return;
      const text = bufferRef.current.join("\n");
      bufferRef.current = [];

      const other = otherRef.current;
      const call = isPatient && meetingCode && other && currentUserId
        ? {
            patientId: currentUserId,
            otherId: other.user_id,
            otherName: other.user_name,
            meetingCode,
          }
        : undefined;

      setHudLoading(true);
      orchestrator.process(text, isPatient, call)
        .then(result => {
          if (result.hud_triggered) setHudCard(result);
        })
        .catch(() => {
          console.warn("[RagOrchestrator] chunk processing failed");
        })
        .finally(() => setHudLoading(false));
    }, CHUNK_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [currentUserId, isPatient, meetingCode]);

  const dismissHud = useCallback(() => setHudCard(null), []);

  return { hudCard, hudLoading, addUtterance, dismissHud };
}
