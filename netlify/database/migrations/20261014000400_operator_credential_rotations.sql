-- Stable operator operation IDs make an explicit password rotation replayable
-- when a database commit succeeds but the CLI loses its acknowledgement.
CREATE TABLE operator_credential_rotations (
  operation_id uuid PRIMARY KEY,
  environment_marker_id uuid NOT NULL REFERENCES hosting_environment_markers(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX operator_credential_rotations_user_created_idx
  ON operator_credential_rotations(user_id, created_at DESC);
