"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { motion, AnimatePresence } from "framer-motion";
import { useChatStore } from "@/store/chat";
import ChatMessage from "@/components/ChatMessage";
import ChatInput from "@/components/ChatInput";
import PersonalityPanel from "@/components/PersonalityPanel";
import PersonalityInsights from "@/components/PersonalityInsights";
import DataActions from "@/components/DataActions";
import SessionSidebar from "@/components/SessionList";
import StatusDot from "@/components/StatusDot";
import ConversationStarters from "@/components/ConversationStarters";
import SplashScreen from "@/components/SplashScreen";
import AgentsDashboard from "@/components/AgentsDashboard";
import OperationsDashboard from "@/components/OperationsDashboard";
import SettingsPage from "@/components/SettingsPage";
import PersonalityPage from "@/components/PersonalityPage";
import AuditPage from "@/components/AuditPage";
import type { Message, HealthStatus } from "@/components/types";
import { fetchSessionHistory } from "@/lib/api";
import { touchRecentSession } from "@/lib/session-storage";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function bundleToMessages(
  turns: Array<{ turn_index: number; user_msg: string; assistant_msg: string | null }>
): Message[] {
  const out: Message[] = [];
  for (const t of turns) {
    out.push({ role: "user", content: t.user_msg });
    out.push({ role: "assistant", content: t.assistant_msg ?? "", turn_index: t.turn_index });
  }
  return out;
}

const useGateway =
  typeof process !== "undefined" &&
  (process.env.NEXT_PUBLIC_USE_GATEWAY === "true" || process.env.NEXT_PUBLIC_USE_GATEWAY === "1");

export default function ChatPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { user: authUser } = useAuth();

  const store = useChatStore();
  const {
    sessionId, messages, input, loading, error, personality, coachingMode, sessionRouting,
    chatMode, healthStatus, feedbackByIndex, ratingsByIndex, agents, splashDone,
  } = store;

  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [feedbackThankIndex, setFeedbackThankIndex] = useState<number | null>(null);
  const [streamingText, setStreamingText] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [panelTab, setPanelTab] = useState<"traits" | "ops">("traits");
  const [activePage, setActivePage] = useState<"chat" | "settings" | "personality" | "audit">("chat");
  const profileLoadedRef = useRef(false);

  /* ── Load stable personality profile for logged-in user ── */
  useEffect(() => {
    if (!authUser || profileLoadedRef.current || personality) return;
    profileLoadedRef.current = true;
    fetch("/api/personality/profile")
      .then((r) => r.json())
      .then((data) => {
        if (data?.profile?.ocean_scores) {
          store.setPersonality({
            ocean: data.profile.ocean_scores,
            stable: data.profile.stable,
            ema_applied: true,
            confidence_scores: data.profile.confidence,
          });
        }
      })
      .catch(() => {});
  }, [authUser, personality, store]);

  /* ── Session init ── */
  useEffect(() => {
    const fromUrl = searchParams.get("session_id");
    if (fromUrl && UUID_RE.test(fromUrl)) {
      store.setSessionId(fromUrl);
      return;
    }
    if (!sessionId) store.setSessionId(crypto.randomUUID());
  }, [searchParams]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Persist to recent sessions ── */
  useEffect(() => {
    if (!sessionId) return;
    const firstUserMsg = messages.find((m) => m.role === "user")?.content;
    touchRecentSession(sessionId, messages.length, firstUserMsg);
  }, [sessionId, messages.length, messages]);

  /* ── Auto-scroll ── */
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading, streamingText]);

  /* ── Health check ── */
  useEffect(() => {
    const check = () => {
      fetch("/api/health")
        .then((r) => {
          if (!r.ok) return "offline" as HealthStatus;
          return r.json().then((d) => (d.ok === true ? "healthy" : "degraded") as HealthStatus);
        })
        .catch(() => "offline" as HealthStatus)
        .then(store.setHealthStatus);
    };
    check();
    const id = setInterval(check, 30000);
    return () => clearInterval(id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Load history ── */
  useEffect(() => {
    if (!sessionId || historyLoaded || messages.length > 0) return;
    let cancelled = false;
    fetchSessionHistory(sessionId)
      .then((bundle) => {
        if (cancelled || !bundle) return;
        const msgs = bundleToMessages(bundle.turns);
        if (msgs.length > 0) store.setMessages(msgs);
        const lastPs = bundle.personality_states[bundle.personality_states.length - 1];
        if (lastPs?.ocean_json && typeof lastPs.ocean_json === "object") {
          store.setPersonality({
            ocean: lastPs.ocean_json as Record<string, number>,
            stable: lastPs.stable,
            ema_applied: true,
          });
        }
      })
      .finally(() => { if (!cancelled) setHistoryLoaded(true); });
    return () => { cancelled = true; };
  }, [sessionId, historyLoaded, messages.length]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Typewriter streaming effect ── */
  const typewriterReveal = useCallback((fullText: string, msg: Message) => {
    let i = 0;
    const step = Math.max(1, Math.floor(fullText.length / 60));
    setStreamingText("");
    const interval = setInterval(() => {
      i = Math.min(i + step, fullText.length);
      setStreamingText(fullText.slice(0, i));
      if (i >= fullText.length) {
        clearInterval(interval);
        setStreamingText(null);
        store.addMessage(msg);
      }
    }, 20);
  }, [store]);

  /* ── Send message ── */
  const sendMessage = useCallback(async (text?: string) => {
    const msgText = (text ?? input).trim();
    if (!msgText || !sessionId) return;
    const startedAt = Date.now();
    store.setInput("");
    store.addMessage({
      role: "user",
      content: msgText,
      timestamp: new Date().toISOString(),
      coaching_mode: coachingMode ?? undefined,
      session_routing: sessionRouting ?? undefined,
    });
    store.setLoading(true);
    store.setError(null);

    store.updateAgentStatus("Coordinator", "processing");
    store.updateAgentStatus("Detector", "processing");

    try {
      const turnIndex = messages.length + 1;
      const modelTier = chatMode === "simple" ? "light" : chatMode === "detailed" ? "heavy" : "medium";
      // Send recent conversation history so the LLM has multi-turn context
      const recentMessages = messages.slice(-10).map((m) => ({
        role: m.role,
        content: m.content,
        coaching_mode: m.coaching_mode,
        session_routing: m.session_routing,
      }));

      const url = useGateway ? "/api/gateway/chat" : "/api/chat";
      const routing_hints = {
        model_tier: modelTier,
        route_key: sessionRouting?.route_key,
        target_mode:
          coachingMode === "emotional_support" ||
          coachingMode === "practical_education" ||
          coachingMode === "policy_navigation" ||
          coachingMode === "mixed"
            ? coachingMode
            : undefined,
        isolation_scope: "mode_lane" as const,
        ...(chatMode === "simple" ? { workflow: "simple" as const } : {}),
      };
      const body = useGateway
        ? {
            session_id: sessionId, turn_index: turnIndex, message: msgText,
            messages: recentMessages,
            context: { language: "en", canton: "ZH" },
            routing_hints,
          }
        : {
            session_id: sessionId, turn_index: turnIndex, message: msgText,
            messages: recentMessages,
            context: { language: "en", canton: "ZH", model_tier: modelTier },
            routing_hints,
            workflow: chatMode === "simple" ? "simple" : undefined,
          };

      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      store.updateAgentStatus("Detector", "active");
      store.updateAgentStatus("Generator", "processing");

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        const msg =
          (typeof errBody?.error === "object" ? errBody.error?.message : null) ??
          errBody?.error ?? errBody?.message ?? `HTTP ${res.status}`;
        throw new Error(msg);
      }

      const data = await res.json();
      const content = data?.message?.content ?? data?.content ?? null;

      store.updateAgentStatus("Generator", "active");
      store.updateAgentStatus("Verifier", "active");
      store.updateAgentStatus("Coordinator", "active");

      if (content == null || content === "") {
        store.addMessage({
          role: "assistant",
          content: "No reply from N8N. Open N8N (http://localhost:5678) and activate the workflow.",
        });
      } else {
        const latencyMs = Date.now() - startedAt;
        const citations =
          (data?.policy_navigation as { citations?: Array<{ source_id: string; title: string; url: string }> } | undefined)
            ?.citations ??
          (Array.isArray((data as { citations?: unknown })?.citations)
            ? (data as { citations: Array<{ source_id: string; title: string; url: string }> }).citations
            : undefined);

        const pipelineStatus = data?.pipeline_status as Record<string, string> | undefined;
        const stageTimings = Array.isArray(data?.stage_timings)
          ? (data.stage_timings as Array<{ stage: string; ms: number }>)
          : undefined;

        const assistantMsg: Message = {
          role: "assistant",
          content,
          turn_index: turnIndex,
          request_id: data?.request_id,
          timestamp: new Date().toISOString(),
          latency_ms: latencyMs,
          citations: citations?.length ? citations : undefined,
          coaching_mode: typeof data?.coaching_mode === "string" ? data.coaching_mode : undefined,
          session_routing:
            data?.session_routing && typeof data.session_routing === "object"
              ? data.session_routing
              : undefined,
          pipeline: {
            mode_confidence: typeof data?.mode_confidence === "number" ? data.mode_confidence : undefined,
            mode_routing_reason: typeof data?.mode_routing_reason === "string" ? data.mode_routing_reason : undefined,
            pipeline_status: pipelineStatus,
            stage_timings: stageTimings,
            route_key:
              data?.session_routing && typeof data.session_routing?.route_key === "string"
                ? data.session_routing.route_key
                : undefined,
            isolation_scope:
              data?.session_routing && typeof data.session_routing?.isolation_scope === "string"
                ? data.session_routing.isolation_scope
                : undefined,
            history_turns_used:
              data?.session_routing && typeof data.session_routing?.history_turns_used === "number"
                ? data.session_routing.history_turns_used
                : undefined,
            history_filtered:
              data?.session_routing && typeof data.session_routing?.history_filtered === "boolean"
                ? data.session_routing.history_filtered
                : undefined,
          },
        };

        typewriterReveal(content, assistantMsg);
      }

      if (data?.personality_state) {
        const ps = data.personality_state as {
          ocean?: Record<string, number>;
          stable?: boolean;
          ema_applied?: boolean;
          confidence_scores?: Record<string, number>;
          confidence?: Record<string, number>;
        };
        const newPs = {
          ocean: ps.ocean ?? {},
          stable: ps.stable,
          ema_applied: ps.ema_applied,
          confidence_scores: ps.confidence_scores ?? ps.confidence,
        };
        store.setPersonality(newPs);
        if (ps.ocean) store.addPersonalitySnapshot(ps.ocean);

        if (authUser && ps.ocean) {
          fetch("/api/personality/profile", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ocean: ps.ocean,
              confidence: ps.confidence_scores ?? ps.confidence ?? {},
            }),
          }).catch(() => {});
        }
      }
      if (data?.coaching_mode) store.setCoachingMode(data.coaching_mode);
      if (data?.session_routing && typeof data.session_routing === "object") {
        store.setSessionRouting(data.session_routing);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Request failed";
      store.setError(msg);
      store.addMessage({ role: "assistant", content: `Error: ${msg}` });
      store.updateAgentStatus("Coordinator", "error");
    } finally {
      store.setLoading(false);
      setTimeout(() => {
        for (const a of ["Detector", "Generator", "Verifier", "Regulator", "Coordinator"]) {
          store.updateAgentStatus(a, "idle");
        }
      }, 2000);
    }
  }, [input, sessionId, messages, chatMode, coachingMode, sessionRouting, store, typewriterReveal, authUser]);

  /* ── Feedback ── */
  const sendFeedback = useCallback(
    async (messageIndex: number, thumbs: "up" | "down") => {
      const msg = messages[messageIndex];
      if (!msg || msg.role !== "assistant" || msg.turn_index == null || !sessionId) return;
      if (feedbackByIndex[messageIndex]) return;
      store.setFeedback(messageIndex, thumbs);
      setFeedbackThankIndex(messageIndex);
      setTimeout(() => setFeedbackThankIndex(null), 2500);
      try {
        await fetch("/api/feedback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            session_id: sessionId,
            turn_index: msg.turn_index,
            request_id: msg.request_id ?? undefined,
            thumbs_up_down: thumbs,
          }),
        });
      } catch {
        store.clearFeedback(messageIndex);
      }
    },
    [messages, sessionId, feedbackByIndex, store]
  );

  const sendRating = useCallback(
    async (messageIndex: number, rating: import("@/components/types").HumanRating) => {
      const msg = messages[messageIndex];
      if (!msg || msg.role !== "assistant" || msg.turn_index == null || !sessionId) return;
      if (ratingsByIndex[messageIndex]) return;
      store.setRating(messageIndex, rating);
      try {
        await fetch("/api/feedback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            session_id: sessionId,
            turn_index: msg.turn_index,
            request_id: msg.request_id ?? undefined,
            ratings: {
              relevance: rating.relevance,
              tone: rating.tone,
              personality_fit: rating.personality_fit,
            },
            comment: rating.comment,
            context: {
              coaching_mode: msg.coaching_mode,
              ocean: personality?.ocean,
            },
          }),
        });
      } catch {
        /* non-blocking */
      }
    },
    [messages, sessionId, ratingsByIndex, personality, store]
  );

  /* ── Session navigation ── */
  const handleSelectSession = useCallback(
    (id: string) => {
      if (id === sessionId) return;
      store.resetSession(id);
      setHistoryLoaded(false);
      router.push(`/?session_id=${encodeURIComponent(id)}`);
    },
    [router, sessionId, store]
  );

  const handleNewChat = useCallback(() => {
    const newId = crypto.randomUUID();
    store.resetSession(newId);
    setHistoryLoaded(true);
    router.push("/");
  }, [router, store]);

  const handleDataDeleted = useCallback(() => {
    store.resetSession(crypto.randomUUID());
    setHistoryLoaded(true);
  }, [store]);

  const handleStarterSelect = useCallback(
    (prompt: string) => {
      sendMessage(prompt);
    },
    [sendMessage]
  );

  /* ── Splash guard ── */
  if (!splashDone) {
    return <SplashScreen onDone={store.setSplashDone} />;
  }

  const msgCount = messages.length;
  const shortId = sessionId ? sessionId.slice(0, 8) : "";

  return (
    <div className="careloop-app">
      {/* ── Left sidebar ── */}
      <SessionSidebar
        currentSessionId={sessionId}
        onSelectSession={handleSelectSession}
        onNewChat={handleNewChat}
        activePage={activePage}
        onNavigate={setActivePage}
      />

      {/* ── Non-chat pages ── */}
      {activePage === "settings" && <SettingsPage />}
      {activePage === "personality" && <PersonalityPage />}
      {activePage === "audit" && <AuditPage />}

      {/* ── Center (chat) ── */}
      {activePage === "chat" && <main className="careloop-center">
        {/* Toolbar */}
        <div className="careloop-toolbar">
          <StatusDot status={healthStatus} />
          <span className="careloop-toolbar__title">
            {shortId && (
              <button
                type="button"
                className="careloop-copy-id"
                onClick={() => navigator.clipboard.writeText(sessionId)}
                title="Copy session ID"
                style={{ marginRight: 8 }}
              >
                {shortId}…
              </button>
            )}
            {msgCount > 0 && `${msgCount} messages`}
          </span>

          <div className="careloop-toolbar__badges">
            {useGateway && <span className="careloop-badge careloop-badge--gateway">Gateway</span>}
            {coachingMode && (
              <span className="careloop-badge careloop-badge--mode">
                {coachingMode.replace(/_/g, " ")}
              </span>
            )}
            {sessionRouting?.route_key && (
              <span className="careloop-badge careloop-badge--stable" title={sessionRouting.route_key}>
                Route {sessionRouting.route_key.split(":").slice(-1)[0]}
              </span>
            )}
            {sessionRouting?.isolation_scope && (
              <span className="careloop-badge careloop-badge--learning">
                {sessionRouting.isolation_scope.replace(/_/g, " ")}
              </span>
            )}
          </div>

          <div className="careloop-mode-select">
            {(["simple", "standard", "detailed"] as const).map((m) => (
              <button
                key={m}
                type="button"
                className={`careloop-mode-select__btn ${chatMode === m ? "careloop-mode-select__btn--active" : ""}`}
                onClick={() => store.setChatMode(m)}
              >
                {m.charAt(0).toUpperCase() + m.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* Banners */}
        {healthStatus === "offline" && (
          <div className="careloop-banner careloop-banner--warning" role="alert">
            <span className="careloop-banner__text">
              Service unavailable. Check API and N8N are running.
            </span>
            <button type="button" className="careloop-banner__btn" onClick={() => store.setHealthStatus("unknown")}>
              Dismiss
            </button>
          </div>
        )}
        {error && (
          <div className="careloop-banner careloop-banner--error" role="alert">
            <span className="careloop-banner__text">{error}</span>
            <button type="button" className="careloop-banner__btn" onClick={() => store.setError(null)}>
              Dismiss
            </button>
          </div>
        )}

        {/* Messages */}
        <div className="careloop-messages">
          {messages.length === 0 && !loading && (
            <div className="careloop-messages__empty">
              <p className="careloop-messages__empty-title">Start a conversation</p>
              <p className="careloop-messages__empty-desc">
                The assistant adapts to your personality and shows insights as you chat.
              </p>
              <ConversationStarters onSelect={handleStarterSelect} />
            </div>
          )}

          <AnimatePresence initial={false}>
            {messages.map((m, i) => (
              <motion.div
                key={`msg-${i}`}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25 }}
              >
                <ChatMessage
                  message={m}
                  index={i}
                  feedback={feedbackByIndex[i]}
                  onFeedback={sendFeedback}
                  showThanks={feedbackThankIndex === i}
                  rating={ratingsByIndex[i] ?? null}
                  onRate={sendRating}
                />
              </motion.div>
            ))}
          </AnimatePresence>

          {/* Streaming reveal */}
          {streamingText != null && (
            <motion.div
              className="careloop-msg careloop-msg--assistant"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <div className="careloop-msg__bubble">
                <span className="careloop-msg__text">{streamingText}</span>
              </div>
            </motion.div>
          )}

          {/* Loading dots (before streaming starts) */}
          {loading && streamingText == null && (
            <motion.div
              className="careloop-msg careloop-msg--assistant"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
            >
              <div className="careloop-msg__bubble">
                <div className="careloop-typing" aria-label="Thinking">
                  <span /><span /><span />
                </div>
                <span className="careloop-typing-label">Thinking…</span>
              </div>
            </motion.div>
          )}
          <div ref={messagesEndRef} aria-hidden="true" />
        </div>

        <ChatInput
          value={input}
          onChange={store.setInput}
          onSend={() => sendMessage()}
          disabled={loading}
          placeholder="Type a message…"
        />
      </main>}

      {/* ── Right panel (tabbed, chat only) ── */}
      {activePage === "chat" && <aside className="careloop-panel">
        <div className="careloop-panel__tabs">
          <button
            type="button"
            className={`careloop-panel__tab ${panelTab === "traits" ? "careloop-panel__tab--active" : ""}`}
            onClick={() => setPanelTab("traits")}
          >
            Traits
          </button>
          <button
            type="button"
            className={`careloop-panel__tab ${panelTab === "ops" ? "careloop-panel__tab--active" : ""}`}
            onClick={() => setPanelTab("ops")}
          >
            Ops
          </button>
        </div>

        <div className="careloop-panel__tab-content">
          {panelTab === "traits" && (
            <>
              <PersonalityPanel personality={personality} />
              <PersonalityInsights personality={personality} />
              <AgentsDashboard agents={agents} />
              <DataActions sessionId={sessionId} onDeleted={handleDataDeleted} />
            </>
          )}
          {panelTab === "ops" && (
            <OperationsDashboard />
          )}
        </div>
      </aside>}
    </div>
  );
}
