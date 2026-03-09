"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/components/AuthProvider";
import {
  getRecentSessions,
  removeRecentSession,
  type RecentSession,
} from "@/lib/session-storage";
import ThemeToggle from "./ThemeToggle";

type SessionSidebarProps = {
  currentSessionId: string;
  onSelectSession: (sessionId: string) => void;
  onNewChat: () => void;
  activePage: "chat" | "settings" | "personality" | "audit";
  onNavigate: (page: "chat" | "settings" | "personality" | "audit") => void;
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function UserMenu() {
  const { user, logout } = useAuth();
  if (!user) return null;
  const initials = (user.name ?? user.email ?? "?")
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <div className="careloop-user-menu">
      <div className="careloop-user-menu__avatar">{initials}</div>
      <div className="careloop-user-menu__info">
        <div className="careloop-user-menu__name">{user.name}</div>
        <div className="careloop-user-menu__email">{user.email}</div>
      </div>
      <button
        type="button"
        className="careloop-user-menu__logout"
        onClick={logout}
      >
        Sign out
      </button>
    </div>
  );
}

const NAV_ITEMS: { id: "chat" | "settings" | "personality" | "audit"; label: string; icon: string }[] = [
  { id: "chat", label: "Chat", icon: "💬" },
  { id: "personality", label: "Personality", icon: "🧠" },
  { id: "audit", label: "Audit Log", icon: "📋" },
  { id: "settings", label: "Settings", icon: "⚙️" },
];

export default function SessionSidebar({
  currentSessionId,
  onSelectSession,
  onNewChat,
  activePage,
  onNavigate,
}: SessionSidebarProps) {
  const { user: authUser } = useAuth();
  const [sessions, setSessions] = useState<RecentSession[]>([]);

  const refresh = useCallback(() => {
    const local = getRecentSessions();
    if (!authUser) {
      setSessions(local);
      return;
    }
    fetch("/api/sessions")
      .then((r) => r.json())
      .then((data) => {
        const dbSessions: RecentSession[] = Array.isArray(data?.sessions)
          ? data.sessions
          : [];
        const merged = new Map<string, RecentSession>();
        for (const s of dbSessions) merged.set(s.id, s);
        for (const s of local) {
          if (!merged.has(s.id)) merged.set(s.id, s);
        }
        const sorted = [...merged.values()].sort(
          (a, b) => new Date(b.lastUsed).getTime() - new Date(a.lastUsed).getTime()
        );
        setSessions(sorted.slice(0, 50));
      })
      .catch(() => setSessions(local));
  }, [authUser]);

  useEffect(() => {
    refresh();
  }, [currentSessionId, refresh]);

  const handleRemove = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    removeRecentSession(id);
    refresh();
  };

  return (
    <aside className="careloop-sidebar">
      <div className="careloop-sidebar__header">
        <div className="careloop-sidebar__brand">
          <span className="careloop-sidebar__logo">CareLoop</span>
          <ThemeToggle />
        </div>
      </div>

      {/* Navigation */}
      <nav className="careloop-sidebar__nav">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`careloop-nav-item ${activePage === item.id ? "careloop-nav-item--active" : ""}`}
            onClick={() => onNavigate(item.id)}
          >
            <span className="careloop-nav-item__icon">{item.icon}</span>
            <span className="careloop-nav-item__label">{item.label}</span>
          </button>
        ))}
      </nav>

      {/* Sessions list (only visible on chat page) */}
      {activePage === "chat" && (
        <>
          <div className="careloop-sidebar__section-header">
            <span>Conversations</span>
            <button
              type="button"
              className="careloop-sidebar__new-btn"
              onClick={onNewChat}
            >
              + New
            </button>
          </div>
          <div className="careloop-sidebar__sessions">
            {sessions.length === 0 ? (
              <div className="careloop-sidebar__empty">
                No conversations yet.
                <br />
                Start chatting!
              </div>
            ) : (
              sessions.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={`careloop-session-item ${s.id === currentSessionId ? "careloop-session-item--active" : ""}`}
                  onClick={() => onSelectSession(s.id)}
                >
                  <span className="careloop-session-item__title">{s.label}</span>
                  <span className="careloop-session-item__meta">
                    <span>{s.messageCount} msgs</span>
                    <span>{timeAgo(s.lastUsed)}</span>
                    {s.id !== currentSessionId && (
                      <span
                        role="button"
                        tabIndex={0}
                        className="careloop-session-item__delete"
                        onClick={(e) => handleRemove(e, s.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleRemove(e as unknown as React.MouseEvent, s.id);
                        }}
                        title="Remove from list"
                      >
                        ✕
                      </span>
                    )}
                  </span>
                </button>
              ))
            )}
          </div>
        </>
      )}

      <UserMenu />
    </aside>
  );
}
