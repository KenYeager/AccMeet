"use client";

type ResultHandler = (text: string, isFinal: boolean) => void;
type ErrorHandler = (error: string) => void;

export function isSpeechRecognitionSupported(): boolean {
  if (typeof window === "undefined") return false;
  return !!(window as any).SpeechRecognition || !!(window as any).webkitSpeechRecognition;
}

/**
 * Wraps the browser's SpeechRecognition API into a continuous captioner.
 * Browsers unilaterally end recognition after periods of silence or a time
 * limit — this restarts it automatically for as long as `start()` is active.
 */
export class LiveCaptioner {
  private recognition: any | null = null;
  private shouldRun = false;

  constructor(
    private onResult: ResultHandler,
    private onError?: ErrorHandler
  ) {}

  start(): void {
    if (this.shouldRun) {
      console.log("[Captions] start() called but already running");
      return;
    }
    if (!isSpeechRecognitionSupported()) {
      console.warn("[Captions] SpeechRecognition not supported in this browser");
      this.onError?.("Live captions aren't supported in this browser — try Chrome or Edge.");
      return;
    }
    console.log("[Captions] starting");
    this.shouldRun = true;
    this._startInstance();
  }

  stop(): void {
    this.shouldRun = false;
    if (this.recognition) {
      this.recognition.onend = null;
      try {
        this.recognition.stop();
      } catch {
        // already stopped
      }
      this.recognition = null;
    }
  }

  private _startInstance(): void {
    if (!this.shouldRun) return;
    const SpeechRecognitionCtor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const recognition = new SpeechRecognitionCtor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onstart = () => {
      console.log("[Captions] recognition session started");
    };

    recognition.onaudiostart = () => {
      console.log("[Captions] mic audio capture started");
    };

    recognition.onresult = (event: any) => {
      let finalText = "";
      let interimText = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) finalText += result[0].transcript;
        else interimText += result[0].transcript;
      }
      console.log("[Captions] onresult", { finalText, interimText });
      if (finalText.trim()) this.onResult(finalText.trim(), true);
      else if (interimText.trim()) this.onResult(interimText.trim(), false);
    };

    recognition.onerror = (event: any) => {
      console.warn("[Captions] onerror", event.error);
      // "no-speech" and "aborted" fire routinely during normal silence — not real errors
      if (event.error !== "no-speech" && event.error !== "aborted") {
        this.onError?.(event.error);
      }
    };

    recognition.onend = () => {
      console.log("[Captions] recognition session ended, shouldRun =", this.shouldRun);
      if (this.shouldRun) this._startInstance();
    };

    try {
      recognition.start();
      this.recognition = recognition;
    } catch (e) {
      console.warn("[Captions] recognition.start() threw", e);
      // start() throws if a recognition session is already active; the
      // existing session's onend will trigger the next restart attempt.
    }
  }
}
