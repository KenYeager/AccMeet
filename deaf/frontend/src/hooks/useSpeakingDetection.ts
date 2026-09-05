"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Detects when the audio from a stream is louder than a threshold,
 * indicating the user is actively speaking / signing.
 */
export function useSpeakingDetection(stream: MediaStream | null | undefined): boolean {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    if (!stream) {
      setIsSpeaking(false);
      return;
    }

    const audioTracks = stream.getAudioTracks();
    if (!audioTracks.length) {
      setIsSpeaking(false);
      return;
    }

    let destroyed = false;
    const ctx = new AudioContext();
    ctxRef.current = ctx;
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.5;
    source.connect(analyser);
    analyserRef.current = analyser;

    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    const THRESHOLD = 20;

    const check = () => {
      if (destroyed) return;
      analyser.getByteFrequencyData(dataArray);
      const avg = dataArray.reduce((s, v) => s + v, 0) / dataArray.length;
      setIsSpeaking(avg > THRESHOLD);
      animFrameRef.current = requestAnimationFrame(check);
    };

    check();

    return () => {
      destroyed = true;
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      ctx.close().catch(() => {});
    };
  }, [stream]);

  return isSpeaking;
}
