"use client";

import { useState, useCallback, useEffect } from "react";

type Message = { role: "user" | "assistant"; content: string };
type Ocean = Record<string, number>;

export default function ChatPage() {
  const [sessionId, setSessionId] = useState<string>("");
  useEffect(() => {
    setSessionId(crypto.randomUUID());
  }, []);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [personalityState, setPersonalityState] = useState<{
    ocean: Ocean;
    stable?: boolean;
    ema_applied?: boolean;
  } | null>(null);
  const [coachingMode, setCoachingMode] = useState<string | null>(null);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || !sessionId) return;
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setLoading(true);
    setError(null);
    try {
      const turnIndex = messages.length + 1;
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId,
          turn_index: turnIndex,
          message: text,
          context: { language: "en", canton: "ZH" },
        }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        const msg = errBody?.error || errBody?.message || `HTTP ${res.status}`;
        throw new Error(msg);
      }
      const data = await res.json();
      const content =
        data?.message?.content ?? data?.content ?? null;
      if (content == null || content === "") {
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content:
              "No reply from N8N. Open N8N (http://localhost:5678) and activate careloop-simplified.json.",
          },
        ]);
      } else {
        setMessages((prev) => [...prev, { role: "assistant", content }]);
      }
      if (data?.personality_state) {
        setPersonalityState({
          ocean: data.personality_state.ocean ?? {},
          stable: data.personality_state.stable,
          ema_applied: data.personality_state.ema_applied,
        });
      }
      if (data?.coaching_mode) setCoachingMode(data.coaching_mode);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Request failed";
      setError(msg);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `Error: ${msg}` },
      ]);
    } finally {
      setLoading(false);
    }
  }, [input, sessionId, messages.length]);

  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: 24 }}>
      <h1 style={{ marginBottom: 16 }}>CareLoop</h1>
      <p style={{ color: "#666", marginBottom: 24 }}>
        Phase 1 MVP. Session: {sessionId ? `${sessionId.slice(0, 8)}…` : "—"}
        {coachingMode && (
          <span style={{ marginLeft: 12 }}>
            · Mode: <strong>{coachingMode}</strong>
          </span>
        )}
      </p>
      {personalityState && (
        <div
          style={{
            marginBottom: 16,
            padding: 12,
            background: "#f0f7ff",
            borderRadius: 8,
            fontSize: 13,
          }}
        >
          <strong>OCEAN</strong> O:{personalityState.ocean.O?.toFixed(2)} C:
          {personalityState.ocean.C?.toFixed(2)} E:
          {personalityState.ocean.E?.toFixed(2)} A:
          {personalityState.ocean.A?.toFixed(2)} N:
          {personalityState.ocean.N?.toFixed(2)}
          {personalityState.stable != null && (
            <span style={{ marginLeft: 8 }}>
              · stable: {String(personalityState.stable)}
            </span>
          )}
        </div>
      )}
      <div
        style={{
          border: "1px solid #ddd",
          borderRadius: 8,
          minHeight: 320,
          padding: 16,
          marginBottom: 16,
          background: "#fafafa",
        }}
      >
        {messages.length === 0 && (
          <p style={{ color: "#888" }}>Send a message to start.</p>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            style={{
              textAlign: m.role === "user" ? "right" : "left",
              marginBottom: 12,
            }}
          >
            <span
              style={{
                display: "inline-block",
                padding: "8px 12px",
                borderRadius: 8,
                maxWidth: "85%",
                background: m.role === "user" ? "#e3f2fd" : "#f5f5f5",
              }}
            >
              {m.content}
            </span>
          </div>
        ))}
        {loading && (
          <p style={{ color: "#888", fontSize: 14 }}>Thinking…</p>
        )}
      </div>
      {error && (
        <p style={{ color: "#c62828", fontSize: 14, marginBottom: 8 }}>
          {error}
        </p>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && sendMessage()}
          placeholder="Type a message…"
          style={{
            flex: 1,
            padding: "10px 12px",
            borderRadius: 8,
            border: "1px solid #ccc",
          }}
        />
        <button
          type="button"
          onClick={sendMessage}
          disabled={loading}
          style={{
            padding: "10px 20px",
            borderRadius: 8,
            border: "none",
            background: "#1976d2",
            color: "white",
            cursor: loading ? "not-allowed" : "pointer",
          }}
        >
          Send
        </button>
      </div>
    </main>
  );
}
