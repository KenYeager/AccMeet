"use client";

import Link from "next/link";
import { BookOpen, Heart, Lightbulb, Sparkles } from "lucide-react";

const features = [
  {
    icon: Sparkles,
    title: "Gentle reminders",
    desc: "When someone comes up in conversation, a quiet on-screen card recalls who they are — so the thread never gets lost.",
  },
  {
    icon: Lightbulb,
    title: "Support for the family",
    desc: "If the same question comes around again, the person on the other end gets a kind suggestion for how to answer it.",
  },
  {
    icon: BookOpen,
    title: "A record of every call",
    desc: "Each conversation is saved as a short story, kept separately for each person they talk to.",
  },
  {
    icon: Heart,
    title: "Built to be easy",
    desc: "Large text, clear buttons, nothing that vanishes on a timer. Runs in the browser — nothing to install.",
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
          <Heart size={28} color="white" />
        </div>

        {/* Headline */}
        <h1 style={{
          fontSize: "clamp(2.25rem, 5vw, 3.75rem)",
          fontWeight: 800,
          lineHeight: 1.1,
          marginBottom: "1.25rem",
          letterSpacing: "-0.02em",
        }}>
          Every call,{" "}
          <span className="gradient-text">easier to follow.</span>
        </h1>

        <p style={{
          fontSize: "1.125rem",
          color: "var(--color-text-secondary)",
          maxWidth: "36rem",
          margin: "0 auto 2.5rem",
          lineHeight: 1.7,
        }}>
          Video calling built for people living with memory loss — and for the
          families who call them. Names and faces are gently recalled on screen,
          and nobody has to remember everything on their own.
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
              <h3 style={{ fontWeight: 600, fontSize: "var(--fs-lead)", marginBottom: "0.5rem" }}>
                {f.title}
              </h3>
              <p style={{ fontSize: "var(--fs-body)", color: "var(--color-text-secondary)", lineHeight: 1.6 }}>
                {f.desc}
              </p>
            </div>
          ))}
        </div>

      </div>
    </main>
  );
}
