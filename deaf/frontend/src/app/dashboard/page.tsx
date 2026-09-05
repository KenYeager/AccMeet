"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, ArrowRight, Check, Pencil, Hand } from "lucide-react";
import { useIdentity } from "@/hooks/useIdentity";
import { meetings, ApiError } from "@/lib/api";
import toast from "react-hot-toast";

function getInitials(name: string) {
  return name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2) || "?";
}

export default function DashboardPage() {
  const router = useRouter();
  const { userId, userName, setUserName, isDeaf, setIsDeaf, isReady } = useIdentity();
  const [nameInput, setNameInput] = useState("");
  const [isEditingName, setIsEditingName] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [isJoining, setIsJoining] = useState(false);

  if (!isReady) {
    return (
      <div className="page-center">
        <Loader2 size={28} className="animate-spin" color="var(--color-blue-400)" />
      </div>
    );
  }

  if (!userName) {
    const handleSubmitName = (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = nameInput.trim();
      if (!trimmed) { toast.error("Enter a name to continue"); return; }
      setUserName(trimmed);
    };

    return (
      <div className="page-center">
        <div className="container-sm fade-in">
          <div style={{ textAlign: "center", marginBottom: "2rem" }}>
            <div style={{
              width: "4rem", height: "4rem",
              background: "linear-gradient(135deg, #2563eb, #6366f1)",
              borderRadius: "1.25rem",
              display: "flex", alignItems: "center", justifyContent: "center",
              margin: "0 auto 1.25rem",
              boxShadow: "0 0 40px rgba(99,102,241,0.4)",
            }}>
              <Hand size={26} color="white" />
            </div>
            <h1 style={{ fontSize: "1.75rem", fontWeight: 800 }}>Welcome to DeafMeet</h1>
            <p style={{ color: "var(--color-text-secondary)", marginTop: "0.5rem", fontSize: "1rem" }}>
              Video meetings with real-time captions & sign language.
            </p>
          </div>
          <div className="glass-card" style={{ padding: "2rem" }}>
            <p style={{ color: "var(--color-text-secondary)", marginBottom: "1rem", fontWeight: 500 }}>
              How should others see your name?
            </p>
            <form onSubmit={handleSubmitName} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              <input
                id="name-input"
                autoFocus
                type="text"
                className="input"
                placeholder="e.g. Alex Johnson"
                value={nameInput}
                onChange={e => setNameInput(e.target.value)}
                maxLength={50}
                style={{ fontSize: "1.125rem" }}
              />

              <label style={{
                display: "flex",
                alignItems: "center",
                gap: "0.75rem",
                padding: "0.75rem 1rem",
                borderRadius: "0.625rem",
                background: "rgba(15, 23, 42, 0.6)",
                border: "1px solid rgba(255, 224, 51, 0.2)",
                cursor: "pointer",
                userSelect: "none"
              }}>
                <input
                  type="checkbox"
                  checked={isDeaf}
                  onChange={e => setIsDeaf(e.target.checked)}
                  style={{ width: "1.25rem", height: "1.25rem", accentColor: "#ffd000", cursor: "pointer" }}
                />
                <div>
                  <div style={{ fontWeight: 700, fontSize: "0.9375rem", color: "var(--color-caption)" }}>
                    I am Deaf / Hard of Hearing
                  </div>
                  <div style={{ fontSize: "0.8125rem", color: "var(--color-text-secondary)" }}>
                    {isDeaf ? "Show ASL Sign Language conversion" : "Normal user (Hide Sign Language)"}
                  </div>
                </div>
              </label>

              <button id="name-continue-btn" type="submit" className="btn btn-primary" style={{ padding: "0.875rem" }}>
                Continue
              </button>
            </form>
          </div>
        </div>
      </div>
    );
  }


  const handleCreateMeeting = async () => {
    setIsCreating(true);
    try {
      const identity = { user_id: userId, user_name: userName };
      const meeting = await meetings.create(identity);
      await meetings.join(meeting.meeting_code, identity);
      toast.success(`Meeting ${meeting.meeting_code} created!`);
      router.push(`/meeting/${meeting.meeting_code}`);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Failed to create meeting";
      toast.error(msg);
    } finally {
      setIsCreating(false);
    }
  };

  const handleJoinMeeting = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = joinCode.trim().toUpperCase();
    if (!code || code.length < 6) { toast.error("Enter a valid 6-character code"); return; }
    setIsJoining(true);
    try {
      await meetings.join(code, { user_id: userId, user_name: userName });
      router.push(`/meeting/${code}`);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Failed to join meeting";
      toast.error(msg);
    } finally {
      setIsJoining(false);
    }
  };

  const handleSaveName = () => {
    const trimmed = nameInput.trim();
    if (!trimmed) { toast.error("Name can't be empty"); return; }
    setUserName(trimmed);
    setIsEditingName(false);
  };

  return (
    <div style={{ minHeight: "100vh", padding: "1.5rem" }}>
      {/* Nav */}
      <nav style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        maxWidth: "64rem", margin: "0 auto 3rem",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <div style={{
            width: "2.25rem", height: "2.25rem",
            background: "linear-gradient(135deg, #2563eb, #6366f1)",
            borderRadius: "0.625rem",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <Hand size={14} color="white" />
          </div>
          <span style={{ fontWeight: 800, fontSize: "1.125rem" }}>DeafMeet</span>
          <span style={{
            fontSize: "0.6875rem", fontWeight: 700, letterSpacing: "0.08em",
            background: "rgba(255,224,51,0.1)", color: "var(--color-caption)",
            border: "1px solid rgba(255,224,51,0.25)",
            padding: "0.2rem 0.5rem", borderRadius: "0.375rem",
            textTransform: "uppercase",
          }}>
            Accessible
          </span>
        </div>

        {/* Name editor */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          {isEditingName ? (
            <>
              <input
                autoFocus
                className="input"
                value={nameInput}
                onChange={e => setNameInput(e.target.value)}
                maxLength={50}
                style={{ width: "12rem", padding: "0.5rem 0.75rem", fontSize: "0.9375rem" }}
                onKeyDown={e => e.key === "Enter" && handleSaveName()}
              />
              <button className="btn btn-ghost" onClick={handleSaveName} style={{ padding: "0.5rem" }}>
                <Check size={16} />
              </button>
            </>
          ) : (
            <>
              <div className="avatar" style={{ width: "2rem", height: "2rem", fontSize: "0.75rem" }}>
                {getInitials(userName)}
              </div>
              <span style={{ fontSize: "0.9375rem", color: "var(--color-text-secondary)" }}>{userName}</span>
              <button
                className="btn btn-ghost"
                onClick={() => { setNameInput(userName); setIsEditingName(true); }}
                style={{ padding: "0.5rem" }}
              >
                <Pencil size={14} />
              </button>
            </>
          )}
        </div>
      </nav>

      {/* Main */}
      <div style={{ maxWidth: "64rem", margin: "0 auto" }}>
        <div className="fade-in" style={{ marginBottom: "2.5rem" }}>
          <h1 style={{ fontSize: "2rem", fontWeight: 800, marginBottom: "0.5rem" }}>
            Good to see you, {userName.split(" ")[0]} 👋
          </h1>
          <p style={{ color: "var(--color-text-secondary)", fontSize: "1.0625rem" }}>
            Start or join a meeting — live captions are on automatically.
          </p>
        </div>

        {/* Feature highlight */}
        <div className="glass-card fade-in" style={{
          padding: "1rem 1.5rem", marginBottom: "2rem",
          background: "rgba(255,224,51,0.04)",
          border: "1px solid rgba(255,224,51,0.15)",
          display: "flex", alignItems: "center", gap: "1rem",
        }}>
          <div style={{
            width: "2.5rem", height: "2.5rem", borderRadius: "0.75rem", flexShrink: 0,
            background: "rgba(255,224,51,0.12)", display: "flex", alignItems: "center", justifyContent: "center",
            border: "1px solid rgba(255,224,51,0.2)",
          }}>
            <span style={{ fontSize: "1.25rem" }}>💬</span>
          </div>
          <div>
            <p style={{ fontWeight: 600, color: "var(--color-caption)", fontSize: "0.9375rem" }}>
              Live captions — always on
            </p>
            <p style={{ color: "var(--color-text-secondary)", fontSize: "0.875rem", marginTop: "0.125rem" }}>
              Real-time speech-to-text with full caption history. No configuration needed.
            </p>
          </div>
        </div>

        <div className="dashboard-grid">
          {/* Create */}
          <div className="glass-card fade-in fade-in-delay-1" style={{ padding: "2rem" }}>
            <div style={{
              width: "3rem", height: "3rem",
              background: "rgba(59,130,246,0.15)",
              border: "1px solid rgba(59,130,246,0.3)",
              borderRadius: "0.875rem",
              display: "flex", alignItems: "center", justifyContent: "center",
              marginBottom: "1.25rem", color: "var(--color-blue-400)",
            }}>
              <Plus size={20} />
            </div>
            <h2 style={{ fontSize: "1.125rem", fontWeight: 700, marginBottom: "0.5rem" }}>New meeting</h2>
            <p style={{ color: "var(--color-text-secondary)", fontSize: "0.9375rem", marginBottom: "1.5rem", lineHeight: 1.6 }}>
              Create a room instantly. Share the code with others and start signing.
            </p>
            <button
              id="create-meeting-btn"
              className="btn btn-primary"
              onClick={handleCreateMeeting}
              disabled={isCreating}
              style={{ width: "100%", padding: "0.875rem" }}
            >
              {isCreating ? <Loader2 size={18} className="animate-spin" /> : <Plus size={18} />}
              {isCreating ? "Creating…" : "Create meeting"}
            </button>
          </div>

          {/* Join */}
          <div className="glass-card fade-in fade-in-delay-2" style={{ padding: "2rem" }}>
            <div style={{
              width: "3rem", height: "3rem",
              background: "rgba(34,197,94,0.12)",
              border: "1px solid rgba(34,197,94,0.25)",
              borderRadius: "0.875rem",
              display: "flex", alignItems: "center", justifyContent: "center",
              marginBottom: "1.25rem", color: "var(--color-success)",
            }}>
              <ArrowRight size={20} />
            </div>
            <h2 style={{ fontSize: "1.125rem", fontWeight: 700, marginBottom: "0.5rem" }}>Join a meeting</h2>
            <p style={{ color: "var(--color-text-secondary)", fontSize: "0.9375rem", marginBottom: "1.5rem", lineHeight: 1.6 }}>
              Have a meeting code? Enter it below to join.
            </p>
            <form onSubmit={handleJoinMeeting} style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              <input
                id="join-code-input"
                type="text"
                className="input"
                placeholder="Enter code (e.g. A3K9X2)"
                value={joinCode}
                onChange={e => setJoinCode(e.target.value.toUpperCase())}
                maxLength={6}
                style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  letterSpacing: "0.2em",
                  textTransform: "uppercase",
                  textAlign: "center",
                  fontSize: "1.25rem",
                }}
              />
              <button
                id="join-meeting-btn"
                type="submit"
                className="btn btn-secondary"
                disabled={isJoining || joinCode.length < 6}
                style={{ padding: "0.875rem" }}
              >
                {isJoining ? <Loader2 size={18} className="animate-spin" /> : <ArrowRight size={18} />}
                {isJoining ? "Joining…" : "Join meeting"}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
