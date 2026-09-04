"use client";

import { useState } from "react";
import { createEvent, EventResult } from "@/lib/api";

interface Props {
  connected: boolean;
}

function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return iso;
  }
}

/** Convert local date + time inputs into an ISO 8601 string with local TZ offset */
function toISO(date: string, time: string): string {
  // e.g. "2026-09-10" + "15:00" → "2026-09-10T15:00:00+05:30"
  const dt = new Date(`${date}T${time}:00`);
  // Build timezone offset string (e.g. +05:30)
  const offset = -dt.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  const hh = String(Math.floor(Math.abs(offset) / 60)).padStart(2, "0");
  const mm = String(Math.abs(offset) % 60).padStart(2, "0");
  // Build ISO without timezone, then append offset
  const pad = (n: number) => String(n).padStart(2, "0");
  const isoLocal =
    `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}` +
    `T${pad(dt.getHours())}:${pad(dt.getMinutes())}:00${sign}${hh}:${mm}`;
  return isoLocal;
}

export default function EventForm({ connected }: Props) {
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<EventResult | null>(null);

  const reset = () => {
    setTitle(""); setDate(""); setStartTime(""); setEndTime("");
    setDescription(""); setLocation(""); setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setResult(null);

    if (!title.trim()) { setError("Event title is required."); return; }
    if (!date)         { setError("Date is required."); return; }
    if (!startTime)    { setError("Start time is required."); return; }
    if (!endTime)      { setError("End time is required."); return; }
    if (startTime >= endTime) {
      setError("End time must be after start time."); return;
    }

    setSubmitting(true);
    try {
      const response = await createEvent({
        title: title.trim(),
        start: toISO(date, startTime),
        end:   toISO(date, endTime),
        description: description.trim() || undefined,
        location:    location.trim()    || undefined,
      });
      setResult(response.event);
      // Clear form on success
      setTitle(""); setDate(""); setStartTime(""); setEndTime("");
      setDescription(""); setLocation("");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create event.");
    } finally {
      setSubmitting(false);
    }
  };

  if (!connected) {
    return (
      <div className="card" style={{ opacity: 0.6, cursor: "not-allowed" }}>
        <p className="card-title">Create Event</p>
        <p style={{ color: "var(--text-faint)", fontSize: "0.9rem" }}>
          Connect Google Calendar above to enable event creation.
        </p>
      </div>
    );
  }

  return (
    <div className="card">
      <p className="card-title">Create Event</p>

      {/* Success result */}
      {result && (
        <>
          <div className="alert alert-success">
            <span className="alert-icon">✓</span>
            <span>Event added to your Google Calendar!</span>
          </div>

          <div className="event-result">
            <div className="event-result-title">{result.title}</div>
            <div className="event-result-time">
              {formatDateTime(result.start)} – {formatDateTime(result.end)}
            </div>
            <a
              href={result.calendar_url}
              target="_blank"
              rel="noopener noreferrer"
              className="event-result-link"
              id="open-calendar-link"
            >
              Open in Google Calendar ↗
            </a>
          </div>

          <hr className="divider" />
        </>
      )}

      {/* Error */}
      {error && (
        <div className="alert alert-error" style={{ marginBottom: "1rem" }}>
          <span className="alert-icon">⚠</span>
          <span>{error}</span>
        </div>
      )}

      <form className="form" onSubmit={handleSubmit} id="event-form" noValidate>
        <div className="form-group">
          <label htmlFor="event-title">Event Title *</label>
          <input
            id="event-title"
            type="text"
            placeholder="e.g. Project Follow-up"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoComplete="off"
            required
          />
        </div>

        <div className="form-group">
          <label htmlFor="event-date">Date *</label>
          <input
            id="event-date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            required
          />
        </div>

        <div className="form-row">
          <div className="form-group">
            <label htmlFor="event-start">Start Time *</label>
            <input
              id="event-start"
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="event-end">End Time *</label>
            <input
              id="event-end"
              type="time"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              required
            />
          </div>
        </div>

        <div className="form-group">
          <label htmlFor="event-description">Description (optional)</label>
          <textarea
            id="event-description"
            placeholder="e.g. Discuss PR feedback and next steps"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        <div className="form-group">
          <label htmlFor="event-location">Location (optional)</label>
          <input
            id="event-location"
            type="text"
            placeholder="e.g. Conference Room A or Zoom link"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
          />
        </div>

        <button
          id="submit-event-btn"
          type="submit"
          className="btn btn-primary btn-full"
          disabled={submitting}
          style={{ marginTop: "0.25rem" }}
        >
          {submitting ? (
            <>
              <span className="spinner" />
              Adding to Calendar…
            </>
          ) : (
            <>📅 Add to Google Calendar</>
          )}
        </button>
      </form>
    </div>
  );
}
