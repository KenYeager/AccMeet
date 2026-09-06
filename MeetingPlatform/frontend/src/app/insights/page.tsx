"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Activity, AlertTriangle, Loader2, TrendingDown, TrendingUp } from "lucide-react";
import { useIdentity } from "@/hooks/useIdentity";
import { insights } from "@/lib/api";
import type { InsightsReport, MetricChange } from "@/types";

const SAMPLE_PATIENT_ID = "sample-demo-patient";

interface Contact {
  patient_id: string;
  patient_name: string;
  other_name: string;
  call_count: number;
  last_call: string | null;
}

function formatDate(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export default function InsightsPage() {
  const { userId, userName, isPatientDevice, isReady } = useIdentity();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [selected, setSelected] = useState<Contact | null>(null);
  const [report, setReport] = useState<InsightsReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadContacts = useCallback(async () => {
    if (!userId) return;
    try {
      const res = await fetch(`/api/conversation/insights/contacts?other_id=${encodeURIComponent(userId)}`);
      const data = await res.json();
      setContacts(data.contacts ?? []);
    } catch {
      setError("Couldn't load your call history.");
    }
  }, [userId]);

  useEffect(() => {
    if (isReady && !isPatientDevice) loadContacts();
  }, [isReady, isPatientDevice, loadContacts]);

  const openReport = async (contact: Contact) => {
    setSelected(contact);
    setReport(null);
    setError(null);
    setLoading(true);
    try {
      setReport(await insights.getReport(contact.patient_id, userId, contact.other_name || userName));
    } catch {
      setError("Couldn't build the report. Is the analysis service running?");
    } finally {
      setLoading(false);
    }
  };

  if (!isReady) {
    return (
      <div className="page-center">
        <Loader2 size={28} className="animate-spin" color="var(--color-blue-400)" />
      </div>
    );
  }

  // Deliberately not shown on the patient's own device — this page is about
  // them, for their family. (UI-level only: the app has no accounts or auth,
  // so this is a courtesy boundary, not a security one.)
  if (isPatientDevice) {
    return (
      <div className="page-center">
        <div className="glass-card container-sm" style={{ padding: "2.5rem", textAlign: "center" }}>
          <p style={{ fontSize: "var(--fs-body)", color: "var(--color-text-secondary)", margin: "0 0 1.5rem" }}>
            This page is for family members.
          </p>
          <Link href="/dashboard" className="btn btn-primary" style={{ padding: "0.75rem 1.5rem" }}>
            Back to calls
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", padding: "1.5rem" }}>
      <div style={{ maxWidth: "56rem", margin: "0 auto" }}>
        <Link
          href="/dashboard"
          className="btn btn-ghost"
          style={{ padding: "0.5rem 0.75rem", marginBottom: "1.5rem", display: "inline-flex" }}
        >
          <ArrowLeft size={16} />
          Back
        </Link>

        <div className="fade-in" style={{ marginBottom: "2rem" }}>
          <h1 style={{ fontSize: "1.875rem", fontWeight: 700, marginBottom: "0.5rem" }}>
            Conversation insights
          </h1>
          <p style={{ color: "var(--color-text-secondary)", fontSize: "var(--fs-body)", lineHeight: 1.6, maxWidth: "44rem" }}>
            After each call we look at how they spoke — how often they circled back to
            something, how varied their words were, how much they hesitated — and compare it
            with their own earlier calls. Only these measurements are kept; nothing that was
            said is ever recorded.
          </p>
        </div>

        {error && (
          <div className="glass-card" style={{ padding: "1rem 1.25rem", marginBottom: "1.5rem", display: "flex", gap: "0.75rem", alignItems: "center" }}>
            <AlertTriangle size={20} color="var(--color-warning)" />
            <span style={{ fontSize: "var(--fs-body)" }}>{error}</span>
          </div>
        )}

        {contacts.length === 0 && (
          <div className="glass-card" style={{ padding: "2rem" }}>
            <p style={{ fontSize: "var(--fs-body)", color: "var(--color-text-secondary)", margin: 0, lineHeight: 1.6 }}>
              No calls recorded yet. Once you&apos;ve had a call with someone whose device is
              set up for memory care, their insights will appear here.
            </p>
          </div>
        )}

        {contacts.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", marginBottom: "2rem" }}>
            {contacts.map(c => {
              const isSelected = selected?.patient_id === c.patient_id;
              return (
                <button
                  key={c.patient_id}
                  onClick={() => openReport(c)}
                  className="glass-card"
                  style={{
                    padding: "1rem 1.25rem", cursor: "pointer", textAlign: "left",
                    font: "inherit", color: "inherit",
                    borderColor: isSelected ? "rgba(96, 165, 250, 0.5)" : undefined,
                  }}
                >
                  <div style={{ fontSize: "var(--fs-lead)", fontWeight: 600, marginBottom: "0.25rem" }}>
                    {c.patient_name}
                    {c.patient_id === SAMPLE_PATIENT_ID && (
                      <span style={{ marginLeft: "0.5rem", fontSize: "var(--fs-label)", fontWeight: 600, color: "var(--color-warning)" }}>
                        Sample data
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: "var(--fs-label)", color: "var(--color-text-secondary)" }}>
                    {c.call_count} call{c.call_count === 1 ? "" : "s"} · last {formatDate(c.last_call)}
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {loading && (
          <div className="glass-card" style={{ padding: "2rem", display: "flex", gap: "0.75rem", alignItems: "center" }}>
            <Loader2 size={20} className="animate-spin" color="var(--color-blue-400)" />
            <span style={{ fontSize: "var(--fs-body)" }}>Building the report…</span>
          </div>
        )}

        {report && !loading && <Report report={report} />}
      </div>
    </div>
  );
}

function Report({ report }: { report: InsightsReport }) {
  if (report.status !== "ready") {
    return (
      <div className="glass-card fade-in" style={{ padding: "2rem" }}>
        <p style={{ fontSize: "var(--fs-body)", color: "var(--color-text-secondary)", margin: 0, lineHeight: 1.6 }}>
          {report.message}
        </p>
      </div>
    );
  }

  const notable = report.changes.filter(c => c.notable);
  const latest = report.latest;

  return (
    <div className="fade-in" style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
      <div className="glass-card" style={{ padding: "1.75rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "1rem", fontSize: "var(--fs-label)", fontWeight: 700, letterSpacing: "0.03em", textTransform: "uppercase", color: "var(--color-accent-label)" }}>
          <Activity size={16} />
          After the last call
        </div>
        <p style={{ fontSize: "var(--fs-lead)", lineHeight: 1.65, margin: 0, whiteSpace: "pre-wrap" }}>
          {report.summary}
        </p>
      </div>

      {notable.length > 0 && (
        <div className="glass-card" style={{ padding: "1.75rem" }}>
          <h2 style={{ fontSize: "var(--fs-title)", fontWeight: 700, margin: "0 0 1rem" }}>
            What changed
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            {notable.map(c => <ChangeRow key={c.metric} change={c} />)}
          </div>
        </div>
      )}

      {latest && latest.observations.length > 0 && (
        <div className="glass-card" style={{ padding: "1.75rem" }}>
          <h2 style={{ fontSize: "var(--fs-title)", fontWeight: 700, margin: "0 0 1rem" }}>
            Noticed during the call
          </h2>
          <ul style={{ margin: 0, paddingLeft: "1.25rem", display: "flex", flexDirection: "column", gap: "0.625rem" }}>
            {latest.observations.map((o, i) => (
              <li key={i} style={{ fontSize: "var(--fs-body)", lineHeight: 1.6 }}>
                {o.replace(/^\[[a-z_]+\]\s*/, "")}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="glass-card" style={{ padding: "1.75rem" }}>
        <h2 style={{ fontSize: "var(--fs-title)", fontWeight: 700, margin: "0 0 0.5rem" }}>
          Every call so far
        </h2>
        <p style={{ fontSize: "var(--fs-label)", color: "var(--color-text-secondary)", margin: "0 0 1rem" }}>
          {report.call_count} calls recorded. Repetitions is the count of times they came back
          to something already covered.
        </p>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--fs-label)", minWidth: "34rem" }}>
            <thead>
              <tr style={{ color: "var(--color-text-secondary)", textAlign: "left" }}>
                <th style={{ padding: "0.5rem 0.75rem 0.5rem 0" }}>Date</th>
                <th style={{ padding: "0.5rem 0.75rem" }}>Repetitions</th>
                <th style={{ padding: "0.5rem 0.75rem" }}>Word variety</th>
                <th style={{ padding: "0.5rem 0.75rem" }}>Vague words</th>
                <th style={{ padding: "0.5rem 0.75rem" }}>Hesitation</th>
              </tr>
            </thead>
            <tbody>
              {[...report.calls].reverse().map(c => (
                <tr key={c.meeting_code + c.timestamp} style={{ borderTop: "1px solid var(--color-glass-border)" }}>
                  <td style={{ padding: "0.625rem 0.75rem 0.625rem 0" }}>{formatDate(c.timestamp)}</td>
                  <td style={{ padding: "0.625rem 0.75rem" }}>{c.repetition_count}</td>
                  <td style={{ padding: "0.625rem 0.75rem" }}>{c.lexical_diversity ?? "—"}</td>
                  <td style={{ padding: "0.625rem 0.75rem" }}>{c.pronoun_rate != null ? `${c.pronoun_rate}%` : "—"}</td>
                  <td style={{ padding: "0.625rem 0.75rem" }}>{c.filler_rate != null ? `${c.filler_rate}%` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function ChangeRow({ change }: { change: MetricChange }) {
  const Icon = change.direction === "up" ? TrendingUp : TrendingDown;
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: "0.875rem" }}>
      <span style={{ display: "flex", flexShrink: 0, color: "var(--color-warning)", marginTop: "0.125rem" }}>
        <Icon size={20} />
      </span>
      <div>
        <div style={{ fontSize: "var(--fs-body)", fontWeight: 600, marginBottom: "0.125rem" }}>
          {change.label}
        </div>
        <div style={{ fontSize: "var(--fs-label)", color: "var(--color-text-secondary)" }}>
          {change.current} this call · usually around {change.baseline}
          {change.percent ? ` · ${change.direction} ${change.percent}%` : ""}
        </div>
      </div>
    </div>
  );
}
