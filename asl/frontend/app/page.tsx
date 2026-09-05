"use client";

import { useEffect, useRef, useState } from "react";

const BACKEND_URL = process.env.NEXT_PUBLIC_ASL_BACKEND_URL ?? "http://127.0.0.1:8010";
const WS_URL = BACKEND_URL.replace(/^http/, "ws") + "/ws/recognize";
const CLIP_DURATION_MS = 3000;

type ServerMessage = {
  type: "translation" | "status" | "error";
  text?: string;
  status?: string;
  error?: string | null;
};

export default function Home() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const socketSessionRef = useRef(0);
  const activeRef = useRef(false);
  const [active, setActive] = useState(false);
  const [status, setStatus] = useState("Ready to start");
  const [translation, setTranslation] = useState("No interpretation yet");
  const [history, setHistory] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => () => stopRecognition(), []);

  function stopRecognition() {
    activeRef.current = false;
    socketSessionRef.current += 1;
    recorderRef.current?.stop();
    recorderRef.current = null;
    socketRef.current?.close();
    socketRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setActive(false);
    setStatus("Ready to start");
  }

  function captureClip() {
    const stream = streamRef.current;
    const socket = socketRef.current;
    const session = socketSessionRef.current;
    if (!stream || !socket || socket.readyState !== WebSocket.OPEN || !activeRef.current) return;
    const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp8") ? "video/webm;codecs=vp8" : "video/webm";
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 450_000 });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
    recorder.onstop = async () => {
      if (session !== socketSessionRef.current || !activeRef.current || !chunks.length || !socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) return;
      const bytes = new Uint8Array(await new Blob(chunks, { type: mimeType }).arrayBuffer());
      let binary = "";
      bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
      socketRef.current.send(JSON.stringify({ clip: btoa(binary), mime_type: "video/webm" }));
    };
    recorderRef.current = recorder;
    recorder.start();
    window.setTimeout(() => { if (recorder.state === "recording") recorder.stop(); }, CLIP_DURATION_MS);
  }

  async function startRecognition() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: false });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      const socket = new WebSocket(WS_URL);
      socketRef.current = socket;
      socket.onopen = () => {
        socketSessionRef.current += 1;
        activeRef.current = true;
        setActive(true);
        setStatus("Collecting 3-second clips");
        captureClip();
      };
      socket.onmessage = (event) => {
        const message = JSON.parse(event.data) as ServerMessage;
        if (message.type === "status") {
          if (message.status === "error") {
            setError(message.error ?? "Gemini is not configured.");
            stopRecognition();
          }
          return;
        }
        if (message.type === "error") {
          setError(message.error ?? "The clip could not be interpreted.");
          if (activeRef.current) window.setTimeout(captureClip, 80);
          return;
        }
        if (message.text === "UNCERTAIN") {
          setTranslation("UNCERTAIN");
          setStatus("Gemini was uncertain; collecting next clip");
        } else if (message.text) {
          setTranslation(message.text);
          setHistory((items) => [...items, message.text as string]);
          setStatus("Translation received; collecting next clip");
        } else {
          setTranslation("No translation returned");
          setStatus("Gemini returned empty output; collecting next clip");
        }
        if (activeRef.current) window.setTimeout(captureClip, 80);
      };
      socket.onerror = () => {
        setError("Cannot reach the ASL backend. Start FastAPI on port 8010.");
        stopRecognition();
      };
      socket.onclose = () => {
        if (activeRef.current) {
          activeRef.current = false;
          recorderRef.current?.stop();
          recorderRef.current = null;
          streamRef.current?.getTracks().forEach((track) => track.stop());
          streamRef.current = null;
          setActive(false);
          setStatus("Backend disconnected");
        }
      };
    } catch (err) {
      setError(err instanceof DOMException && err.name === "NotAllowedError" ? "Camera permission was denied." : "Camera is unavailable.");
      stopRecognition();
    }
  }

  return (
    <main className="shell">
      <header className="header"><div><p className="eyebrow">GEMINI VIDEO UNDERSTANDING</p><h1>ASL translator</h1></div><span className={`status ${active ? "live" : ""}`}><i />{status}</span></header>
      <section className="workspace">
        <div className="camera-panel"><div className="camera-frame"><video ref={videoRef} muted playsInline /><div className="camera-placeholder">{active ? "" : "Camera preview"}</div>{active && <span className="live-label">LIVE</span>}</div><div className="controls"><button className="primary" onClick={active ? stopRecognition : startRecognition}>{active ? "Stop recognition" : "Start recognition"}</button><button className="secondary" onClick={() => { setHistory([]); setTranslation("No interpretation yet"); }} disabled={!history.length}>Clear text</button></div></div>
        <div className="translation-panel"><p className="eyebrow">LATEST INTERPRETATION</p><div className="current-sign">{translation}</div><div className="divider" /><p className="eyebrow">SUBTITLE HISTORY</p><div className="translation">{history.length ? history.join(" ") : <span className="muted">Short ASL video interpretations will appear here.</span>}</div>{error && <div className="error">{error}</div>}<p className="note">Each request contains one 3-second webcam clip. Gemini interprets the sign sequence as a whole instead of predicting alphabet letters frame by frame.</p></div>
      </section>
    </main>
  );
}
