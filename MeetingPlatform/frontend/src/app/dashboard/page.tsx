"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Mic, Plus, ArrowRight, Loader2, Pencil, Check, HeartPulse, Activity } from "lucide-react";
import Link from "next/link";
import { useIdentity } from "@/hooks/useIdentity";
import { meetings, ApiError } from "@/lib/api";
import toast from "react-hot-toast";

function getInitials(name: string) {
  return name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2) || "?";
}

export default function DashboardPage() {
  const router = useRouter();
  const { userId, userName, setUserName, isPatientDevice, setIsPatientDevice, isReady } = useIdentity();
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

  // No name set yet — this is the only "onboarding" step in the whole app.
  if (!userName) {
    const handleSubmitName = (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = nameInput.trim();
      if (!trimmed) {
        toast.error("Enter a name to continue");
        return;
      }
      setUserName(trimmed);
    };

    return (
      <div className="page-center">
        <div className="container-sm fade-in">
          <div style={{ textAlign: "center", marginBottom: "2rem" }}>
            <div style={{
              width: "3.5rem",
              height: "3.5rem",
              background: "linear-gradient(135deg, #3b82f6, #6366f1)",
              borderRadius: "1rem",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto 1rem",
              boxShadow: "0 0 30px rgba(99, 102, 241, 0.35)",
            }}>
              <Mic size={22} color="white" />
            </div>
            <h1 style={{ fontSize: "1.5rem", fontWeight: 700 }}>What&apos;s your name?</h1>
            <p style={{ color: "var(--color-text-secondary)", fontSize: "var(--fs-body)", marginTop: "0.375rem" }}>
              This is how others will see you in meetings.
            </p>
          </div>

          <div className="glass-card" style={{ padding: "2rem" }}>
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
              />
              <button id="name-continue-btn" type="submit" className="btn btn-primary" style={{ padding: "0.75rem" }}>
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
      router.push(`/meeting/${meeting.meeting_code}${isPatientDevice ? "?patient=1" : ""}`);
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
    if (!code || code.length < 6) {
      toast.error("Enter a valid 6-character meeting code");
      return;
    }

    setIsJoining(true);
    try {
      await meetings.join(code, { user_id: userId, user_name: userName });
      router.push(`/meeting/${code}${isPatientDevice ? "?patient=1" : ""}`);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Failed to join meeting";
      toast.error(msg);
    } finally {
      setIsJoining(false);
    }
  };

  const handleSaveName = () => {
    const trimmed = nameInput.trim();
    if (!trimmed) {
      toast.error("Name can't be empty");
      return;
    }
    setUserName(trimmed);
    setIsEditingName(false);
  };

  return (
    <div style={{ minHeight: "100vh", padding: "1.5rem" }}>

      {/* Top nav */}
      <nav style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        maxWidth: "56rem",
        margin: "0 auto 3rem",
      }}>
        {/* Logo */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.625rem" }}>
          <div style={{
            width: "2rem",
            height: "2rem",
            background: "linear-gradient(135deg, #3b82f6, #6366f1)",
            borderRadius: "0.5rem",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}>
            <Mic size={12} color="white" />
          </div>
          <span style={{ fontWeight: 700 }}>AccMeet</span>
        </div>

        {/* Name + edit */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.625rem" }}>
          {isEditingName ? (
            <>
              <input
                autoFocus
                className="input"
                value={nameInput}
                onChange={e => setNameInput(e.target.value)}
                maxLength={50}
                style={{ width: "12rem", padding: "0.5rem 0.75rem" }}
                onKeyDown={e => e.key === "Enter" && handleSaveName()}
              />
              <button className="btn btn-ghost" onClick={handleSaveName} style={{ padding: "0.5rem 0.75rem" }}>
                <Check size={16} />
                Save
              </button>
            </>
          ) : (
            <>
              <div className="avatar" style={{ width: "2rem", height: "2rem", fontSize: "0.75rem" }}>
                {getInitials(userName)}
              </div>
              <span style={{ fontSize: "var(--fs-body)", color: "var(--color-text-secondary)" }}>
                {userName}
              </span>
              <button
                className="btn btn-ghost"
                onClick={() => { setNameInput(userName); setIsEditingName(true); }}
                style={{ padding: "0.5rem 0.75rem" }}
              >
                <Pencil size={14} />
                Change
              </button>
            </>
          )}
        </div>
      </nav>

      {/* Main content */}
      <div style={{ maxWidth: "56rem", margin: "0 auto" }}>
        <div className="fade-in" style={{ marginBottom: "2.5rem" }}>
          <h1 style={{ fontSize: "1.875rem", fontWeight: 700, marginBottom: "0.5rem" }}>
            Good to see you, {userName.split(" ")[0]} 👋
          </h1>
          <p style={{ color: "var(--color-text-secondary)" }}>
            Start a new meeting or join one with a code.
          </p>
        </div>

        {/* Caregiver-only: never linked on the patient's own device, since the
            report is about them and written for their family. */}
        {!isPatientDevice && (
          <Link
            href="/insights"
            className="glass-card fade-in"
            style={{
              display: "flex", alignItems: "center", gap: "1rem", padding: "1.25rem 1.5rem",
              marginBottom: "1.5rem", textDecoration: "none", color: "inherit",
            }}
          >
            <Activity size={24} color="var(--color-blue-400)" style={{ flexShrink: 0 }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: "var(--fs-lead)", fontWeight: 600, marginBottom: "0.125rem" }}>
                Conversation insights
              </div>
              <div style={{ fontSize: "var(--fs-body)", color: "var(--color-text-secondary)" }}>
                How your calls have been going, and anything worth raising with their doctor.
              </div>
            </div>
            <ArrowRight size={20} color="var(--color-text-secondary)" style={{ flexShrink: 0 }} />
          </Link>
        )}

        {/* Device-level setting (persisted, not per-meeting) — "this device
            belongs to a memory-care patient" so every meeting it creates or
            joins automatically gets the context/history bubbles, with no
            need to hand-edit a link. */}
        <label
          className="glass-card fade-in"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "1rem",
            padding: "1.5rem",
            marginBottom: "1.5rem",
            cursor: "pointer",
            borderColor: isPatientDevice ? "rgba(96, 165, 250, 0.45)" : undefined,
          }}
        >
          <input
            type="checkbox"
            checked={isPatientDevice}
            onChange={e => setIsPatientDevice(e.target.checked)}
            style={{ width: "1.75rem", height: "1.75rem", cursor: "pointer", flexShrink: 0 }}
          />
          <HeartPulse size={26} color="var(--color-blue-400)" style={{ flexShrink: 0 }} />
          <div>
            <div style={{ fontSize: "var(--fs-lead)", fontWeight: 600, marginBottom: "0.25rem" }}>
              This is a memory-care patient&apos;s device
            </div>
            <div style={{ fontSize: "var(--fs-body)", color: "var(--color-text-secondary)", lineHeight: 1.5 }}>
              Turns on the larger, calmer screen with on-screen reminders and a record of past
              calls. Leave this off on a family member&apos;s phone or laptop.
            </div>
          </div>
        </label>

        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: "1.25rem",
        }}>

          {/* Create Meeting Card */}
          <div className="glass-card fade-in fade-in-delay-1" style={{ padding: "2rem" }}>
            <div style={{
              width: "3rem",
              height: "3rem",
              background: "linear-gradient(135deg, rgba(59, 130, 246, 0.2), rgba(99, 102, 241, 0.2))",
              border: "1px solid rgba(99, 102, 241, 0.3)",
              borderRadius: "0.875rem",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              marginBottom: "1.25rem",
              color: "var(--color-blue-400)",
            }}>
              <Plus size={20} />
            </div>
            <h2 style={{ fontSize: "1.125rem", fontWeight: 600, marginBottom: "0.5rem" }}>
              New meeting
            </h2>
            <p style={{ color: "var(--color-text-secondary)", fontSize: "var(--fs-body)", marginBottom: "1.5rem", lineHeight: 1.6 }}>
              Create a room instantly. Share the code with your team and start talking.
            </p>
            <button
              id="create-meeting-btn"
              className="btn btn-primary"
              onClick={handleCreateMeeting}
              disabled={isCreating}
              style={{ width: "100%", padding: "0.75rem" }}
            >
              {isCreating ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
              {isCreating ? "Creating…" : "Create meeting"}
            </button>
          </div>

          {/* Join Meeting Card */}
          <div className="glass-card fade-in fade-in-delay-2" style={{ padding: "2rem" }}>
            <div style={{
              width: "3rem",
              height: "3rem",
              background: "linear-gradient(135deg, rgba(34, 197, 94, 0.15), rgba(16, 185, 129, 0.15))",
              border: "1px solid rgba(34, 197, 94, 0.25)",
              borderRadius: "0.875rem",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              marginBottom: "1.25rem",
              color: "var(--color-success)",
            }}>
              <ArrowRight size={20} />
            </div>
            <h2 style={{ fontSize: "1.125rem", fontWeight: 600, marginBottom: "0.5rem" }}>
              Join a meeting
            </h2>
            <p style={{ color: "var(--color-text-secondary)", fontSize: "var(--fs-body)", marginBottom: "1.5rem", lineHeight: 1.6 }}>
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
                  fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                  letterSpacing: "0.15em",
                  textTransform: "uppercase",
                  textAlign: "center",
                  fontSize: "1.125rem",
                }}
              />
              <button
                id="join-meeting-btn"
                type="submit"
                className="btn btn-secondary"
                disabled={isJoining || joinCode.length < 6}
                style={{ padding: "0.75rem" }}
              >
                {isJoining ? <Loader2 size={16} className="animate-spin" /> : <ArrowRight size={16} />}
                {isJoining ? "Joining…" : "Join meeting"}
              </button>
            </form>
          </div>

        </div>
      </div>
    </div>
  );
}
