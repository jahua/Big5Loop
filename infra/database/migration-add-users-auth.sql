-- Migration: Add user authentication + personality profiles
-- Run on existing CareLoop databases that already have the base schema

-- 1. Users table
CREATE TABLE IF NOT EXISTS users (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email          TEXT UNIQUE NOT NULL,
  password_hash  TEXT NOT NULL,
  display_name   TEXT,
  locale         TEXT DEFAULT 'de',
  canton         CHAR(2),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Link sessions to users (backward-compatible: NULL = anonymous)
ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON chat_sessions(user_id);

-- 3. Stable cross-session personality profile per user
CREATE TABLE IF NOT EXISTS user_personality_profiles (
  user_id        UUID PRIMARY KEY REFERENCES users(id),
  ocean_scores   JSONB NOT NULL DEFAULT '{"O":0,"C":0,"E":0,"A":0,"N":0}',
  confidence     JSONB NOT NULL DEFAULT '{"O":0,"C":0,"E":0,"A":0,"N":0}',
  total_turns    INT NOT NULL DEFAULT 0,
  stable         BOOLEAN NOT NULL DEFAULT false,
  last_updated   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. Seed 5 test users (password for all: careloop123)
INSERT INTO users (email, password_hash, display_name, locale, canton) VALUES
('alice@careloop.ch', '$2a$10$BrS0H/n/.MEfEIUfQS7.0u33SSK2Ja197qOrKg9Kng5r77qPk3zdu', 'Alice Müller', 'de', 'ZH'),
('bob@careloop.ch', '$2a$10$BrS0H/n/.MEfEIUfQS7.0u33SSK2Ja197qOrKg9Kng5r77qPk3zdu', 'Bob Schneider', 'de', 'BE'),
('carol@careloop.ch', '$2a$10$BrS0H/n/.MEfEIUfQS7.0u33SSK2Ja197qOrKg9Kng5r77qPk3zdu', 'Carol Weber', 'de', 'LU'),
('david@careloop.ch', '$2a$10$BrS0H/n/.MEfEIUfQS7.0u33SSK2Ja197qOrKg9Kng5r77qPk3zdu', 'David Fischer', 'de', 'ZH'),
('eva@careloop.ch', '$2a$10$BrS0H/n/.MEfEIUfQS7.0u33SSK2Ja197qOrKg9Kng5r77qPk3zdu', 'Eva Brunner', 'de', 'BS')
ON CONFLICT (email) DO NOTHING;
