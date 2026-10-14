CREATE TABLE hosting_environment_markers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('production', 'preview', 'local')),
  database_fingerprint text NOT NULL CHECK (database_fingerprint ~ '^[0-9a-f]{64}$'),
  storage_store text NOT NULL CHECK (length(storage_store) BETWEEN 1 AND 64 AND storage_store !~ '[/ :]'),
  storage_region text NOT NULL CHECK (storage_region IN ('ap-southeast-1', 'ap-southeast-2', 'eu-central-1', 'us-east-2')),
  deployment_context text NOT NULL CHECK (length(deployment_context) BETWEEN 1 AND 64),
  initialized_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE active_hosting_environment (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  marker_id uuid NOT NULL REFERENCES hosting_environment_markers(id) ON DELETE RESTRICT,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE ftc_cases ADD COLUMN environment_marker_id uuid REFERENCES hosting_environment_markers(id) ON DELETE RESTRICT;
CREATE INDEX ftc_cases_environment_owner_updated_idx ON ftc_cases(environment_marker_id, owner_id, updated_at DESC);

ALTER TABLE attachments
  ADD COLUMN environment_marker_id uuid REFERENCES hosting_environment_markers(id) ON DELETE RESTRICT,
  ADD COLUMN cleanup_pending boolean NOT NULL DEFAULT false,
  ADD COLUMN storage_deleted_at timestamptz;

CREATE INDEX attachments_cleanup_pending_idx ON attachments(created_at) WHERE cleanup_pending;

CREATE FUNCTION protect_case_environment_marker() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.environment_marker_id IS DISTINCT FROM NEW.environment_marker_id THEN
    RAISE EXCEPTION 'case environment mapping is immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER ftc_cases_environment_marker_guard BEFORE UPDATE OF environment_marker_id ON ftc_cases
  FOR EACH ROW EXECUTE FUNCTION protect_case_environment_marker();

CREATE FUNCTION protect_attachment_storage_metadata() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.case_id IS DISTINCT FROM NEW.case_id OR OLD.storage_environment IS DISTINCT FROM NEW.storage_environment OR
     OLD.storage_store IS DISTINCT FROM NEW.storage_store OR OLD.storage_region IS DISTINCT FROM NEW.storage_region OR
     OLD.storage_key IS DISTINCT FROM NEW.storage_key OR OLD.environment_marker_id IS DISTINCT FROM NEW.environment_marker_id OR
     OLD.display_name IS DISTINCT FROM NEW.display_name OR OLD.media_type IS DISTINCT FROM NEW.media_type OR
     OLD.byte_size IS DISTINCT FROM NEW.byte_size OR OLD.sha256 IS DISTINCT FROM NEW.sha256 OR OLD.kind IS DISTINCT FROM NEW.kind OR
     NOT (OLD.source_id IS NOT DISTINCT FROM NEW.source_id OR
       (NEW.status='deleted' AND NEW.source_id IS NULL)) OR
     NOT (OLD.remittance_id IS NOT DISTINCT FROM NEW.remittance_id OR
       (NEW.status='deleted' AND NEW.remittance_id IS NULL)) THEN
    RAISE EXCEPTION 'attachment evidence metadata is immutable' USING ERRCODE = '55000';
  END IF;
  IF OLD.status <> NEW.status AND NOT (
       (OLD.status='pending' AND NEW.status IN ('ready','failed','deleted')) OR
       (OLD.status='failed' AND NEW.status IN ('pending','deleted')) OR
       (OLD.status='ready' AND NEW.status='deleted')) THEN
    RAISE EXCEPTION 'invalid attachment status transition' USING ERRCODE = '23514';
  END IF;
  IF OLD.status='deleted' AND NEW.status<>'deleted' THEN
    RAISE EXCEPTION 'deleted attachment tombstone is immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER attachments_metadata_guard BEFORE UPDATE ON attachments FOR EACH ROW EXECUTE FUNCTION protect_attachment_storage_metadata();

-- Cleanup bookkeeping may complete after a case is submitted. All evidence data
-- and the tombstone remain frozen; only these two operational fields can move.
DROP TRIGGER attachments_state_guard ON attachments;
CREATE FUNCTION protect_attachment_after_submission() RETURNS trigger LANGUAGE plpgsql AS $$
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
       (to_jsonb(OLD) - 'cleanup_pending' - 'storage_deleted_at') =
       (to_jsonb(NEW) - 'cleanup_pending' - 'storage_deleted_at') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'submitted case evidence is immutable' USING ERRCODE = '55000';
  END IF;
  IF coalesce(submitted,false) THEN
    RAISE EXCEPTION 'submitted case evidence is immutable' USING ERRCODE = '55000';
  END IF;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER attachments_state_guard BEFORE INSERT OR UPDATE OR DELETE ON attachments
  FOR EACH ROW EXECUTE FUNCTION protect_attachment_after_submission();

ALTER TABLE calculation_snapshots ADD COLUMN policy_id text;
UPDATE calculation_snapshots SET policy_id = policy->>'id';
ALTER TABLE calculation_snapshots ALTER COLUMN policy_id SET NOT NULL;
ALTER TABLE calculation_snapshots ADD COLUMN engine_version text;
UPDATE calculation_snapshots SET engine_version = result->>'engineVersion';
ALTER TABLE calculation_snapshots ALTER COLUMN engine_version SET NOT NULL;
ALTER TABLE calculation_snapshots ADD COLUMN created_sequence bigserial NOT NULL;
CREATE UNIQUE INDEX calculation_snapshots_sequence_idx ON calculation_snapshots(created_sequence);

ALTER TABLE officer_case_assignments ADD COLUMN active boolean NOT NULL DEFAULT true;
CREATE UNIQUE INDEX one_active_officer_assignment_per_case ON officer_case_assignments(case_id) WHERE active;

CREATE INDEX calculation_snapshots_preview_lookup_idx
  ON calculation_snapshots(case_id, revision, created_at DESC) WHERE kind = 'preview';

CREATE INDEX audit_events_officer_access_idx ON audit_events(case_id, occurred_at DESC);
ALTER TABLE audit_events ADD COLUMN created_sequence bigserial NOT NULL;
CREATE UNIQUE INDEX audit_events_sequence_idx ON audit_events(created_sequence);
CREATE INDEX audit_events_case_sequence_idx ON audit_events(case_id, created_sequence DESC);
