"use client";

import Link from "next/link";
import { Mic, Users, Zap, Shield } from "lucide-react";

const features = [
  {
    icon: Mic,
    title: "Crystal-clear audio",
    desc: "Peer-to-peer WebRTC audio — no server in the path, ultra-low latency.",
  },
  {
    icon: Zap,
    title: "Instant meetings",
    desc: "Create a room in one click. Share the code. Done.",
  },
  {
    icon: Users,
    title: "Up to 6 participants",
    desc: "Perfect for standups, quick syncs, and small team calls.",
  },
  {
    icon: Shield,
    title: "No downloads",
    desc: "Runs entirely in your browser. Nothing to install.",
  },
];

export default function LandingPage() {
  return (
    <main className="page-center flex-col" style={{ padding: "4rem 1.5rem" }}>
      <div className="container-md fade-in" style={{ textAlign: "center" }}>

        {/* Logo mark */}
        <div style={{
          width: "4.5rem",
          height: "4.5rem",
          background: "linear-gradient(135deg, #3b82f6, #6366f1)",
          borderRadius: "1.25rem",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          margin: "0 auto 2rem",
          boxShadow: "0 0 40px rgba(99, 102, 241, 0.4)",
        }}>
          <Mic size={28} color="white" />
        </div>

        {/* Headline */}
        <h1 style={{
          fontSize: "clamp(2.25rem, 5vw, 3.75rem)",
          fontWeight: 800,
          lineHeight: 1.1,
          marginBottom: "1.25rem",
          letterSpacing: "-0.02em",
        }}>
          Audio meetings,{" "}
          <span className="gradient-text">instant.</span>
        </h1>

        <p style={{
          fontSize: "1.125rem",
          color: "var(--color-text-secondary)",
          maxWidth: "36rem",
          margin: "0 auto 2.5rem",
          lineHeight: 1.7,
        }}>
          No downloads, no complexity. Create a room, share the code, start talking.
          Powered by WebRTC for direct peer-to-peer audio.
        </p>

        {/* CTA */}
        <div style={{ display: "flex", gap: "1rem", justifyContent: "center", flexWrap: "wrap", marginBottom: "5rem" }}>
          <Link href="/dashboard" className="btn btn-primary" style={{ padding: "0.875rem 2rem", fontSize: "1rem" }}>
            Get started
          </Link>
        </div>

        {/* Feature grid */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: "1rem",
          textAlign: "left",
        }}>
          {features.map((f, i) => (
            <div
              key={f.title}
              className="glass-card glass-card-hover fade-in"
              style={{ padding: "1.5rem", animationDelay: `${i * 0.1}s`, opacity: 0 }}
            >
              <div style={{
                width: "2.5rem",
                height: "2.5rem",
                background: "rgba(99, 102, 241, 0.15)",
                borderRadius: "0.75rem",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                marginBottom: "0.875rem",
                color: "var(--color-blue-400)",
              }}>
                <f.icon size={18} />
              </div>
              <h3 style={{ fontWeight: 600, fontSize: "0.9375rem", marginBottom: "0.375rem" }}>
                {f.title}
              </h3>
              <p style={{ fontSize: "0.875rem", color: "var(--color-text-secondary)", lineHeight: 1.6 }}>
                {f.desc}
              </p>
            </div>
          ))}
        </div>

      </div>
    </main>
  );
}
