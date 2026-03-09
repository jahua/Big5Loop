-- Human ratings table for in-chat expert evaluation (RQ2 validation)
-- Stores per-turn quality ratings on three dimensions aligned with manuscript Table 7

CREATE TABLE IF NOT EXISTS human_ratings (
    id              SERIAL PRIMARY KEY,
    session_id      TEXT NOT NULL,
    turn_index      INTEGER,
    request_id      TEXT,
    relevance       SMALLINT NOT NULL CHECK (relevance BETWEEN 1 AND 5),
    tone            SMALLINT NOT NULL CHECK (tone BETWEEN 1 AND 5),
    personality_fit SMALLINT NOT NULL CHECK (personality_fit BETWEEN 1 AND 5),
    comment         TEXT,
    ocean_snapshot  JSONB,
    coaching_mode   TEXT,
    rater_role      TEXT DEFAULT 'expert',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_human_ratings_session_turn UNIQUE (session_id, turn_index)
);

CREATE INDEX IF NOT EXISTS idx_human_ratings_session ON human_ratings (session_id);
CREATE INDEX IF NOT EXISTS idx_human_ratings_mode ON human_ratings (coaching_mode);
CREATE INDEX IF NOT EXISTS idx_human_ratings_created ON human_ratings (created_at);

COMMENT ON TABLE human_ratings IS 'Per-turn human quality ratings for RQ2 evaluation (tone, relevance, personality fit)';
COMMENT ON COLUMN human_ratings.relevance IS 'Response relevance and coherence (1-5 Likert)';
COMMENT ON COLUMN human_ratings.tone IS 'Emotional tone appropriateness (1-5 Likert)';
COMMENT ON COLUMN human_ratings.personality_fit IS 'Personality-adaptive style fit (1-5 Likert)';
COMMENT ON COLUMN human_ratings.ocean_snapshot IS 'OCEAN state at time of rating for correlation analysis';
COMMENT ON COLUMN human_ratings.rater_role IS 'Role of rater: expert, caregiver, researcher';
