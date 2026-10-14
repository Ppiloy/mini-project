CREATE TABLE operator_environment_gates (
  environment_marker_id uuid PRIMARY KEY REFERENCES hosting_environment_markers(id) ON DELETE RESTRICT,
  operation_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('closed', 'ready')),
  credential_file_sha256 text NOT NULL CHECK (credential_file_sha256 ~ '^[0-9a-f]{64}$'),
  backup_sha256 text NOT NULL CHECK (backup_sha256 ~ '^[0-9a-f]{64}$'),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'ready' OR updated_at IS NOT NULL)
);
