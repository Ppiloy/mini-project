CREATE TABLE operator_demo_resets (
  operation_id uuid PRIMARY KEY,
  environment_marker_id uuid NOT NULL REFERENCES hosting_environment_markers(id) ON DELETE RESTRICT,
  manifest_sha256 text NOT NULL CHECK (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  backup_sha256 text,
  retention_cutoff timestamptz,
  case_ids uuid[] NOT NULL,
  blob_keys text[] NOT NULL DEFAULT '{}',
  credential_file_sha256 text NOT NULL CHECK (credential_file_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CHECK (backup_sha256 IS NULL OR backup_sha256 ~ '^[0-9a-f]{64}$')
);

CREATE FUNCTION demo_reset_allows_case(case_key uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM operator_demo_resets reset
    WHERE reset.operation_id = nullif(current_setting('ftc.demo_reset_operation', true), '')::uuid
      AND reset.completed_at IS NULL AND reset.environment_marker_id = (
        SELECT environment_marker_id FROM ftc_cases WHERE id=case_key
      ) AND case_key = ANY(reset.case_ids)
  )
$$;

CREATE OR REPLACE FUNCTION protect_case_state() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'submitted' AND NOT demo_reset_allows_case(OLD.id) THEN
      RAISE EXCEPTION 'submitted cases are immutable' USING ERRCODE = '55000';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status='submitted' AND demo_reset_allows_case(OLD.id) AND
     NEW.status='draft' AND NEW.submitted_snapshot_id IS NULL AND NEW.submitted_at IS NULL AND
     (to_jsonb(OLD) - 'status' - 'submitted_snapshot_id' - 'submitted_at') =
     (to_jsonb(NEW) - 'status' - 'submitted_snapshot_id' - 'submitted_at') THEN
    RETURN NEW;
  END IF;
  IF OLD.status = 'submitted' THEN RAISE EXCEPTION 'submitted cases are immutable' USING ERRCODE = '55000'; END IF;
  IF NEW.status NOT IN ('draft', 'submitted') OR (OLD.status = 'submitted' AND NEW.status <> 'submitted') THEN
    RAISE EXCEPTION 'invalid case state transition' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION protect_child_after_submission() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE case_key uuid;
BEGIN
  case_key := CASE WHEN TG_OP = 'DELETE' THEN OLD.case_id ELSE NEW.case_id END;
  IF TG_OP = 'DELETE' AND demo_reset_allows_case(case_key) THEN RETURN OLD; END IF;
  IF EXISTS (SELECT 1 FROM ftc_cases WHERE id = case_key AND status = 'submitted') OR
     (TG_OP = 'UPDATE' AND EXISTS (SELECT 1 FROM ftc_cases WHERE id = OLD.case_id AND status = 'submitted')) THEN
    RAISE EXCEPTION 'submitted case records are immutable' USING ERRCODE = '55000';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;

CREATE OR REPLACE FUNCTION protect_attachment_after_submission() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE submitted boolean;
BEGIN
  IF TG_OP='DELETE' THEN
    IF demo_reset_allows_case(OLD.case_id) THEN RETURN OLD; END IF;
    IF EXISTS (SELECT 1 FROM ftc_cases WHERE id=OLD.case_id AND status='submitted') THEN
      RAISE EXCEPTION 'submitted case evidence is immutable' USING ERRCODE = '55000';
    END IF;
    RETURN OLD;
  END IF;
  SELECT status='submitted' INTO submitted FROM ftc_cases WHERE id=NEW.case_id;
  IF TG_OP='UPDATE' AND EXISTS (SELECT 1 FROM ftc_cases WHERE id=OLD.case_id AND status='submitted') THEN
    IF OLD.status='deleted' AND NEW.status='deleted' AND
       (to_jsonb(OLD) - 'cleanup_pending' - 'storage_deleted_at' - 'cleanup_requested_at' -
        'cleanup_attempt_count' - 'cleanup_last_attempt_at' - 'cleanup_last_error' -
        'cleanup_claim_token' - 'cleanup_claimed_at') =
       (to_jsonb(NEW) - 'cleanup_pending' - 'storage_deleted_at' - 'cleanup_requested_at' -
        'cleanup_attempt_count' - 'cleanup_last_attempt_at' - 'cleanup_last_error' -
        'cleanup_claim_token' - 'cleanup_claimed_at') THEN RETURN NEW; END IF;
    RAISE EXCEPTION 'submitted case evidence is immutable' USING ERRCODE = '55000';
  END IF;
  IF coalesce(submitted,false) THEN RAISE EXCEPTION 'submitted case evidence is immutable' USING ERRCODE = '55000'; END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION prevent_immutable_record_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' AND demo_reset_allows_case(OLD.case_id) THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'record is immutable' USING ERRCODE = '55000';
END $$;
