-- Apply this once in Supabase SQL Editor to enable native Google OAuth handoff.
CREATE TABLE IF NOT EXISTS mobile_oauth_tickets (
  ticket_hash TEXT PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  handoff_challenge TEXT NOT NULL,
  expires_at BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE mobile_oauth_tickets ADD COLUMN IF NOT EXISTS handoff_challenge TEXT;
UPDATE mobile_oauth_tickets SET handoff_challenge='' WHERE handoff_challenge IS NULL;
ALTER TABLE mobile_oauth_tickets ALTER COLUMN handoff_challenge SET NOT NULL;
CREATE INDEX IF NOT EXISTS mobile_oauth_tickets_expiry ON mobile_oauth_tickets(expires_at);
ALTER TABLE mobile_oauth_tickets ENABLE ROW LEVEL SECURITY;
