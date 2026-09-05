"use client";

/**
 * useAslRecognition
 *
 * Hybrid ASL Recognition:
 * 1. Fast Client-Side MediaPipe Hands (Zero config, works out of the box without any API key)
 *    Detects handshape geometry and maps to ASL signs: HELLO, GOOD, I LOVE YOU, YES, NO,
 *    PEACE, STOP, WAIT, HELP, numbers, etc.
 * 2. Server-side Gemini 1.5 Flash Vision (/api/asl/frame)
 *    When GEMINI_API_KEY is configured in deaf/backend/.env, frames are sent to Gemini Vision
 *    for advanced sign language interpretation.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { AslRecognitionEntry } from "@/types";

const MAX_HISTORY = 40;
const FRAME_INTERVAL_MS = 500;
const SIGN_COOLDOWN_MS = 1500;
const GEMINI_FRAME_INTERVAL_MS = 1800; // Check Gemini Vision every 1.8s if active

interface Landmark {
  x: number;
  y: number;
  z: number;
}

function fingerExtended(landmarks: Landmark[], tipIdx: number, pipIdx: number): boolean {
  return landmarks[tipIdx].y < landmarks[pipIdx].y;
}

function classifySign(landmarks: Landmark[]): { word: string; confidence: number } | null {
  if (!landmarks || landmarks.length < 21) return null;

  const thumbUp  = fingerExtended(landmarks, 4, 3);
  const indexUp  = fingerExtended(landmarks, 8, 6);
  const middleUp = fingerExtended(landmarks, 12, 10);
  const ringUp   = fingerExtended(landmarks, 16, 14);
  const pinkyUp  = fingerExtended(landmarks, 20, 18);

  const numExtended = [thumbUp, indexUp, middleUp, ringUp, pinkyUp].filter(Boolean).length;

  const thumbTip = landmarks[4];
  const indexTip = landmarks[8];
  const pinkyTip = landmarks[20];
  const wrist    = landmarks[0];

  const dist = (a: Landmark, b: Landmark) =>
    Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);

  // I LOVE YOU: Thumb + index + pinky extended
  if (thumbUp && indexUp && !middleUp && !ringUp && pinkyUp) {
    return { word: "I LOVE YOU", confidence: 0.94 };
  }

  // All 5 fingers extended and spread
  if (thumbUp && indexUp && middleUp && ringUp && pinkyUp) {
    const spread = dist(thumbTip, pinkyTip);
    if (spread > 0.35) return { word: "HELLO", confidence: 0.92 };
    if (spread > 0.25) return { word: "STOP", confidence: 0.88 };
    return { word: "THANK YOU", confidence: 0.85 };
  }

  // Fist (all down) => YES
  if (!indexUp && !middleUp && !ringUp && !pinkyUp && !thumbUp) {
    return { word: "YES", confidence: 0.82 };
  }

  // Thumb only up => GOOD
  if (thumbUp && !indexUp && !middleUp && !ringUp && !pinkyUp && thumbTip.y < wrist.y) {
    return { word: "GOOD", confidence: 0.90 };
  }

  // Index + middle => PEACE / NO
  if (!thumbUp && indexUp && middleUp && !ringUp && !pinkyUp) {
    const vSpread = dist(indexTip, landmarks[12]);
    if (vSpread > 0.08) return { word: "PEACE", confidence: 0.86 };
    return { word: "NO", confidence: 0.84 };
  }

  // 4 fingers up (no thumb) => WAIT
  if (!thumbUp && indexUp && middleUp && ringUp && pinkyUp) {
    return { word: "WAIT", confidence: 0.82 };
  }

  // Index only => HELP / 1
  if (!thumbUp && indexUp && !middleUp && !ringUp && !pinkyUp) {
    return { word: "HELP", confidence: 0.80 };
  }

  // Fallback number signs
  if (numExtended === 1) return { word: "1", confidence: 0.75 };
  if (numExtended === 2) return { word: "2", confidence: 0.75 };
  if (numExtended === 3) return { word: "3", confidence: 0.75 };
  if (numExtended === 4) return { word: "4", confidence: 0.75 };
  if (numExtended === 5) return { word: "HELLO", confidence: 0.75 };

  return null;
}

export function useAslRecognition(
  videoStream: MediaStream | null | undefined,
  participantName: string,
  active: boolean,
) {
  const [entries, setEntries] = useState<AslRecognitionEntry[]>([]);
  const [isDetecting, setIsDetecting] = useState(false);
  const [lastSign, setLastSign] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const handsRef = useRef<any>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastRecordedSignRef = useRef<{ word: string; timestamp: number } | null>(null);
  const lastGeminiCallRef = useRef<number>(0);
  const geminiInFlightRef = useRef<boolean>(false);
  const activeRef = useRef(active);
  const participantNameRef = useRef(participantName);

  useEffect(() => { activeRef.current = active; }, [active]);
  useEffect(() => { participantNameRef.current = participantName; }, [participantName]);

  const recordRecognizedSign = useCallback((word: string, confidence: number) => {
    if (!word || word === "UNKNOWN") return;
    const now = Date.now();
    const prev = lastRecordedSignRef.current;

    // Cooldown check for repeated identical sign
    if (prev && prev.word === word && now - prev.timestamp < SIGN_COOLDOWN_MS) {
      return;
    }

    lastRecordedSignRef.current = { word, timestamp: now };
    setLastSign(word);

    const newEntry: AslRecognitionEntry = {
      id: `asl-${now}`,
      word,
      confidence,
      timestamp: now,
      participantName: participantNameRef.current,
    };

    setEntries((prevEntries) => {
      const next = [...prevEntries, newEntry];
      return next.length > MAX_HISTORY ? next.slice(next.length - MAX_HISTORY) : next;
    });
  }, []);

  const onMediaPipeResults = useCallback((results: any) => {
    if (!activeRef.current) return;
    if (!results.multiHandLandmarks || results.multiHandLandmarks.length === 0) {
      setIsDetecting(false);
      return;
    }

    setIsDetecting(true);
    const landmarks = results.multiHandLandmarks[0] as Landmark[];
    const classified = classifySign(landmarks);
    if (classified) {
      recordRecognizedSign(classified.word, classified.confidence);
    }
  }, [recordRecognizedSign]);

  useEffect(() => {
    if (!active || !videoStream) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      if (handsRef.current) {
        try { handsRef.current.close(); } catch (_) {}
        handsRef.current = null;
      }
      if (videoRef.current) {
        videoRef.current.srcObject = null;
        videoRef.current = null;
      }
      canvasRef.current = null;
      setIsDetecting(false);
      return;
    }

    let destroyed = false;

    const initDetector = async () => {
      try {
        // Setup MediaPipe Hands
        const { Hands } = await import("@mediapipe/hands");
        if (destroyed) return;

        const hands = new Hands({
          locateFile: (file: string) =>
            `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1646424915/${file}`,
        });
        hands.setOptions({
          maxNumHands: 1,
          modelComplexity: 0,
          minDetectionConfidence: 0.60,
          minTrackingConfidence: 0.60,
        });
        hands.onResults(onMediaPipeResults);
        handsRef.current = hands;

        // Video and Canvas setup
        const video = document.createElement("video");
        video.srcObject = videoStream;
        video.muted = true;
        video.playsInline = true;
        video.play().catch(() => {});
        videoRef.current = video;

        const canvas = document.createElement("canvas");
        canvas.width = 360;
        canvas.height = 270;
        canvasRef.current = canvas;

        intervalRef.current = setInterval(async () => {
          if (destroyed || !activeRef.current || !videoRef.current || !canvasRef.current) return;
          const v = videoRef.current;
          const c = canvasRef.current;
          if (v.readyState < 2) return;

          const ctx = c.getContext("2d");
          if (!ctx) return;
          ctx.drawImage(v, 0, 0, c.width, c.height);

          // 1. Run local MediaPipe hands classification
          if (handsRef.current) {
            try {
              await handsRef.current.send({ image: c });
            } catch (_) {}
          }

          // 2. Concurrently ping Gemini Vision if interval elapsed and not currently in flight
          const now = Date.now();
          if (now - lastGeminiCallRef.current >= GEMINI_FRAME_INTERVAL_MS && !geminiInFlightRef.current) {
            lastGeminiCallRef.current = now;
            geminiInFlightRef.current = true;

            const base64Data = c.toDataURL("image/jpeg", 0.65);
            fetch("/api/asl/frame", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ image_base64: base64Data }),
            })
              .then((res) => (res.ok ? res.json() : null))
              .then((data) => {
                const text = (data?.text || "").trim().toUpperCase();
                if (text && text !== "UNKNOWN") {
                  recordRecognizedSign(text, 0.98);
                }
              })
              .catch(() => {})
              .finally(() => {
                geminiInFlightRef.current = false;
              });
          }
        }, FRAME_INTERVAL_MS);
      } catch (err) {
        console.error("[ASL Recognition] Init error:", err);
      }
    };

    initDetector();

    return () => {
      destroyed = true;
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      if (handsRef.current) {
        try { handsRef.current.close(); } catch (_) {}
        handsRef.current = null;
      }
      if (videoRef.current) {
        videoRef.current.srcObject = null;
        videoRef.current = null;
      }
      canvasRef.current = null;
      setIsDetecting(false);
    };
  }, [active, videoStream, onMediaPipeResults, recordRecognizedSign]);

  const clearHistory = useCallback(() => {
    setEntries([]);
    lastRecordedSignRef.current = null;
    setLastSign(null);
  }, []);

  return { entries, isDetecting, lastSign, clearHistory };
}
