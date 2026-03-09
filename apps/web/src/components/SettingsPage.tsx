"use client";

import { useState } from "react";
import { useAuth } from "@/components/AuthProvider";

export default function SettingsPage() {
  const { user, refresh } = useAuth();
  const [displayName, setDisplayName] = useState(user?.name ?? "");
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const saveProfile = async () => {
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch("/api/auth/update-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName }),
      });
      const data = await res.json();
      if (!res.ok) { setMsg({ type: "err", text: data.error ?? "Failed" }); return; }
      setMsg({ type: "ok", text: "Profile updated" });
      refresh();
    } catch { setMsg({ type: "err", text: "Network error" }); }
    finally { setSaving(false); }
  };

  const changePassword = async () => {
    if (newPw.length < 6) { setMsg({ type: "err", text: "Password must be at least 6 characters" }); return; }
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: currentPw, newPassword: newPw }),
      });
      const data = await res.json();
      if (!res.ok) { setMsg({ type: "err", text: data.error ?? "Failed" }); return; }
      setMsg({ type: "ok", text: "Password changed" });
      setCurrentPw("");
      setNewPw("");
    } catch { setMsg({ type: "err", text: "Network error" }); }
    finally { setSaving(false); }
  };

  return (
    <div className="careloop-page">
      <div className="careloop-page__header">
        <h1>Settings</h1>
        <p className="careloop-page__subtitle">Manage your account and preferences</p>
      </div>

      <div className="careloop-page__content">
        {msg && (
          <div className={`careloop-page__alert careloop-page__alert--${msg.type}`}>
            {msg.text}
          </div>
        )}

        <section className="careloop-card">
          <h2 className="careloop-card__title">Profile</h2>
          <div className="careloop-form-row">
            <label>Email</label>
            <input type="email" value={user?.email ?? ""} disabled className="careloop-input careloop-input--disabled" />
          </div>
          <div className="careloop-form-row">
            <label>Display Name</label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="careloop-input"
            />
          </div>
          <button className="careloop-btn careloop-btn--primary" onClick={saveProfile} disabled={saving}>
            {saving ? "Saving…" : "Save Profile"}
          </button>
        </section>

        <section className="careloop-card">
          <h2 className="careloop-card__title">Change Password</h2>
          <div className="careloop-form-row">
            <label>Current Password</label>
            <input
              type="password"
              value={currentPw}
              onChange={(e) => setCurrentPw(e.target.value)}
              className="careloop-input"
              autoComplete="current-password"
            />
          </div>
          <div className="careloop-form-row">
            <label>New Password</label>
            <input
              type="password"
              value={newPw}
              onChange={(e) => setNewPw(e.target.value)}
              className="careloop-input"
              placeholder="At least 6 characters"
              autoComplete="new-password"
            />
          </div>
          <button className="careloop-btn careloop-btn--primary" onClick={changePassword} disabled={saving}>
            {saving ? "Saving…" : "Change Password"}
          </button>
        </section>

        <section className="careloop-card">
          <h2 className="careloop-card__title">Account Info</h2>
          <div className="careloop-info-grid">
            <div className="careloop-info-item">
              <span className="careloop-info-label">User ID</span>
              <span className="careloop-info-value careloop-info-value--mono">{user?.id?.slice(0, 8)}…</span>
            </div>
            <div className="careloop-info-item">
              <span className="careloop-info-label">Email</span>
              <span className="careloop-info-value">{user?.email}</span>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
