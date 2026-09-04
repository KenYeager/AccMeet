"use client";

import { useState } from "react";

interface CopilotResponse {
  hud_triggered: boolean;
  tool_name: string | null;
  query: string | null;
  hud_card_data: string | null;
  assistant_response: string;
}

export default function Page() {
  const [loreText, setLoreText] = useState("");
  const [category, setCategory] = useState("kinship");
  const [entityName, setEntityName] = useState("");
  const [ingestStatus, setIngestStatus] = useState("");

  const [transcriptChunk, setTranscriptChunk] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CopilotResponse | null>(null);

  const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000";

  const handleIngest = async () => {
    if (!loreText) return;
    setIngestStatus("Ingesting...");
    try {
      const res = await fetch(`${API_BASE}/api/rag/ingest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: [
            {
              text: loreText,
              category: category,
              entity_name: entityName,
            },
          ],
        }),
      });
      if (res.ok) {
        setIngestStatus("Ingested successfully!");
        setLoreText("");
        setEntityName("");
      } else {
        setIngestStatus("Error ingesting entry.");
      }
    } catch {
      setIngestStatus("Server connection failed.");
    }
  };

  const handleSimulateChunk = async (chunkToSend?: string) => {
    const text = chunkToSend || transcriptChunk;
    if (!text) return;

    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/agent/process-chunk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chunk: text }),
      });
      const data = await res.json();
      setResult(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="max-w-5xl mx-auto p-6 space-y-8">
      <header className="border-b border-gray-800 pb-4">
        <h1 className="text-2xl font-bold text-white tracking-tight">
          Ambient Copilot: Isolated RAG Tool Harness
        </h1>
        <p className="text-sm text-gray-400 mt-1">
          Simulate real-time transcript events and observe vector retrieval triggers.
        </p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* Left Column: Lore Seeding & Audio/Transcript Simulator */}
        <div className="space-y-6">
          {/* Document Ingestion Box */}
          <section className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
            <h2 className="text-md font-semibold text-gray-200">1. Seed Lore Knowledge Base</h2>
            <div className="space-y-2">
              <input
                type="text"
                placeholder="Entity / Name (e.g., Maya, Project Falcon)"
                value={entityName}
                onChange={(e) => setEntityName(e.target.value)}
                className="w-full bg-gray-950 border border-gray-700 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
              />
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full bg-gray-950 border border-gray-700 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
              >
                <option value="kinship">Kinship (Family & Relatives)</option>
                <option value="coworker">Coworker / Roles</option>
                <option value="project_lore">Project Lore & Repos</option>
              </select>
              <textarea
                rows={3}
                placeholder="e.g., Maya is the user's elder daughter. She works at Google Bangalore as an SRE."
                value={loreText}
                onChange={(e) => setLoreText(e.target.value)}
                className="w-full bg-gray-950 border border-gray-700 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
              />
            </div>
            <div className="flex items-center justify-between">
              <button
                onClick={handleIngest}
                className="bg-blue-600 hover:bg-blue-500 text-white font-medium text-xs px-4 py-2 rounded-md transition"
              >
                Store in Vector Database
              </button>
              {ingestStatus && <span className="text-xs text-gray-400">{ingestStatus}</span>}
            </div>
          </section>

          {/* Transcript Simulator */}
          <section className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
            <h2 className="text-md font-semibold text-gray-200">2. Transcript Chunk Simulator</h2>
            <textarea
              rows={3}
              placeholder="Paste or type a spoken chunk, e.g., 'Maya reached out earlier today regarding the move...'"
              value={transcriptChunk}
              onChange={(e) => setTranscriptChunk(e.target.value)}
              className="w-full bg-gray-950 border border-gray-700 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500"
            />

            <div className="flex items-center gap-2">
              <button
                onClick={() => handleSimulateChunk()}
                disabled={loading}
                className="bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-xs px-4 py-2 rounded-md disabled:opacity-50 transition"
              >
                {loading ? "Agent Evaluating..." : "Stream Transcript Chunk"}
              </button>
            </div>

            {/* Quick Test Presets */}
            <div className="pt-2 border-t border-gray-800 space-y-1">
              <span className="text-xs text-gray-400">Quick Test Samples:</span>
              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  onClick={() => {
                    const sample = "Hey Maya called earlier about Bangalore.";
                    setTranscriptChunk(sample);
                    handleSimulateChunk(sample);
                  }}
                  className="text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 px-2.5 py-1 rounded"
                >
                  "Maya called earlier..."
                </button>
                <button
                  onClick={() => {
                    const sample = "Can we sync tomorrow at 3 PM to review the deck?";
                    setTranscriptChunk(sample);
                    handleSimulateChunk(sample);
                  }}
                  className="text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 px-2.5 py-1 rounded"
                >
                  "Can we sync tomorrow at 3 PM..."
                </button>
              </div>
            </div>
          </section>
        </div>

        {/* Right Column: Heads-Up Display (HUD) Preview */}
        <div className="space-y-4">
          <h2 className="text-md font-semibold text-gray-200 flex items-center justify-between">
            <span>3. HUD Context Output Preview</span>
            <span className="text-xs font-normal text-gray-500 font-mono">Live WebSocket Target</span>
          </h2>

          <div className="border border-gray-800 bg-gray-950 rounded-xl p-6 min-h-[420px] flex flex-col justify-between">
            {result ? (
              <div className="space-y-4">
                {/* Visual HUD Card Indicator */}
                <div className="flex items-center justify-between pb-3 border-b border-gray-800">
                  <span className="text-xs uppercase font-mono tracking-wider text-gray-400">
                    Action Status
                  </span>
                  {result.hud_triggered ? (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-900/50 text-blue-400 border border-blue-700">
                      ● Tool Executed: {result.tool_name}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-gray-800 text-gray-400 border border-gray-700">
                      ○ No Assistive Action Triggered
                    </span>
                  )}
                </div>

                {/* Retrieved Context Visual Card */}
                {result.hud_triggered && result.hud_card_data && (
                  <div className="bg-blue-950/30 border border-blue-800/80 rounded-lg p-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold uppercase text-blue-400 tracking-wider">
                        Retrieved Context Card
                      </span>
                      <span className="text-xs text-blue-300 font-mono">
                        Query: &quot;{result.query}&quot;
                      </span>
                    </div>
                    <p className="text-sm text-gray-200 whitespace-pre-wrap leading-relaxed">
                      {result.hud_card_data}
                    </p>
                  </div>
                )}

                {/* Copilot Reasoning / Output */}
                <div className="space-y-1">
                  <span className="text-xs uppercase font-mono text-gray-500">Agent Note</span>
                  <div className="bg-gray-900 border border-gray-800 rounded p-3 text-xs text-gray-300 font-mono">
                    {result.assistant_response || "NO_ACTION"}
                  </div>
                </div>
              </div>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-center text-gray-500 my-auto">
                <p className="text-sm">No transcript chunks evaluated yet.</p>
                <p className="text-xs text-gray-600 mt-1">
                  Enter a transcript snippet on the left to test the RAG routing loop.
                </p>
              </div>
            )}

            <div className="pt-4 border-t border-gray-900 text-xs text-gray-600 flex justify-between font-mono">
              <span>Model: gpt-4o-mini</span>
              <span>Vector Store: MongoDB Atlas</span>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}