-- Reserve authentication work before password verification so concurrent attempts
-- share the same persistent account-level threshold. Expired reservations are
-- reclaimed by the next attempt; a killed Function cannot hold a slot forever.
CREATE TABLE login_attempt_reservations (
  reservation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  login_name text NOT NULL REFERENCES login_attempt_limits(login_name) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);

CREATE INDEX login_attempt_reservations_account_expiry_idx
  ON login_attempt_reservations(login_name, expires_at);
