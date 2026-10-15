ALTER TABLE attachments
  ADD COLUMN cleanup_requested_at timestamptz,
  ADD COLUMN cleanup_attempt_count integer NOT NULL DEFAULT 0 CHECK (cleanup_attempt_count >= 0),
  ADD COLUMN cleanup_last_attempt_at timestamptz,
  ADD COLUMN cleanup_last_error text,
  ADD COLUMN cleanup_claim_token uuid,
  ADD COLUMN cleanup_claimed_at timestamptz;

CREATE INDEX attachments_cleanup_retry_idx
  ON attachments(environment_marker_id, cleanup_requested_at, cleanup_claimed_at)
  WHERE status = 'deleted';

CREATE FUNCTION stamp_attachment_cleanup_request() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'deleted' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'deleted') THEN
    NEW.cleanup_requested_at := coalesce(NEW.cleanup_requested_at, now());
    NEW.cleanup_pending := true;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER attachments_cleanup_request_stamp
  BEFORE INSERT OR UPDATE OF status ON attachments
  FOR EACH ROW EXECUTE FUNCTION stamp_attachment_cleanup_request();

CREATE OR REPLACE FUNCTION protect_attachment_after_submission() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE submitted boolean;
BEGIN
  IF TG_OP='DELETE' THEN
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
        'cleanup_claim_token' - 'cleanup_claimed_at') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'submitted case evidence is immutable' USING ERRCODE = '55000';
  END IF;
  IF coalesce(submitted,false) THEN
    RAISE EXCEPTION 'submitted case evidence is immutable' USING ERRCODE = '55000';
  END IF;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;

-- Existing tombstones on submitted cases can be backfilled only after the
-- submitted-evidence trigger explicitly permits cleanup bookkeeping fields.
UPDATE attachments
SET cleanup_requested_at = created_at
WHERE status = 'deleted' AND cleanup_pending AND cleanup_requested_at IS NULL;

CREATE TABLE preview_environment_initialization (
  environment_marker_id uuid PRIMARY KEY REFERENCES hosting_environment_markers(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ready')),
  operation_id uuid,
  credential_file_sha256 text CHECK (credential_file_sha256 IS NULL OR credential_file_sha256 ~ '^[0-9a-f]{64}$'),
  initialized_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status='pending' AND initialized_at IS NULL) OR (status='ready' AND operation_id IS NOT NULL AND initialized_at IS NOT NULL))
);
INSERT INTO preview_environment_initialization(environment_marker_id, status)
SELECT id, 'pending' FROM hosting_environment_markers WHERE kind='preview'
ON CONFLICT (environment_marker_id) DO NOTHING;
