import type { SignalingMessage, SignalingMessageType } from "@/types";

const WS_BASE = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:8000";
const MAX_RECONNECT_ATTEMPTS = 3;
const RECONNECT_DELAY_MS = 2000;

type MessageHandler = (message: SignalingMessage) => void;

export class SignalingClient {
  private ws: WebSocket | null = null;
  private meetingCode: string = "";
  private userId: string = "";
  private userName: string = "";
  private handlers: Map<SignalingMessageType | "open" | "close" | "error", MessageHandler[]> = new Map();
  private reconnectAttempts = 0;
  private shouldReconnect = true;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  connect(meetingCode: string, userId: string, userName: string): void {
    this.meetingCode = meetingCode;
    this.userId = userId;
    this.userName = userName;
    this.shouldReconnect = true;
    this.reconnectAttempts = 0;
    this._connect();
  }

  private _connect(): void {
    const params = new URLSearchParams({ user_id: this.userId, user_name: this.userName });
    const url = `${WS_BASE}/ws/${this.meetingCode}?${params.toString()}`;
    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      this._emit("open" as any, {} as any);
    };

    this.ws.onmessage = (event) => {
      try {
        const message: SignalingMessage = JSON.parse(event.data);
        this._emit(message.type, message);
      } catch {
        console.error("[Signaling] Failed to parse message:", event.data);
      }
    };

    this.ws.onclose = (event) => {
      this._emit("close" as any, {} as any);

      if (this.shouldReconnect && this.reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        this.reconnectAttempts++;
        console.log(`[Signaling] Reconnecting (attempt ${this.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})…`);
        this.reconnectTimer = setTimeout(() => this._connect(), RECONNECT_DELAY_MS * this.reconnectAttempts);
      } else if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        this._emit("error" as any, { type: "error", payload: { message: "Connection lost" } } as any);
      }
    };

    this.ws.onerror = () => {
      this._emit("error" as any, { type: "error", payload: { message: "WebSocket error" } } as any);
    };
  }

  send(type: string, payload: unknown, targetUserId?: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn("[Signaling] Cannot send — WebSocket not open");
      return;
    }
    const message: Record<string, unknown> = { type, payload };
    if (targetUserId) message.target_user_id = targetUserId;
    this.ws.send(JSON.stringify(message));
  }

  on(type: SignalingMessageType | "open" | "close" | "error", handler: MessageHandler): void {
    const existing = this.handlers.get(type) || [];
    this.handlers.set(type, [...existing, handler]);
  }

  off(type: SignalingMessageType | "open" | "close" | "error", handler?: MessageHandler): void {
    if (!handler) {
      this.handlers.delete(type);
    } else {
      const existing = this.handlers.get(type) || [];
      this.handlers.set(type, existing.filter(h => h !== handler));
    }
  }

  disconnect(): void {
    this.shouldReconnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  private _emit(type: SignalingMessageType | "open" | "close" | "error", message: SignalingMessage): void {
    const handlers = this.handlers.get(type) || [];
    handlers.forEach(h => {
      try {
        h(message);
      } catch (e) {
        console.error("[Signaling] Handler error:", e);
      }
    });
  }
}
