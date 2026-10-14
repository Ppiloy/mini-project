CREATE TABLE app_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  login_name text NOT NULL UNIQUE CHECK (login_name = lower(login_name) AND length(login_name) BETWEEN 3 AND 80),
  display_name text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 160),
  password_hash text NOT NULL CHECK (password_hash LIKE 'scrypt$%'),
  role text NOT NULL CHECK (role IN ('taxpayer', 'officer')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE user_profiles (
  user_id uuid PRIMARY KEY REFERENCES app_users(id) ON DELETE RESTRICT,
  masked_reference text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE user_sessions (
  sid text PRIMARY KEY,
  sess json NOT NULL,
  expire timestamptz NOT NULL
);
CREATE INDEX user_sessions_expire_idx ON user_sessions(expire);

CREATE TABLE login_attempt_limits (
  login_name text PRIMARY KEY,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  window_started_at timestamptz NOT NULL DEFAULT now(),
  blocked_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ftc_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted')),
  tax_year integer,
  domestic_assessable_income numeric(30,12) CHECK (domestic_assessable_income IS NULL OR domestic_assessable_income >= 0),
  thai_tax_before_ftc numeric(30,12) CHECK (thai_tax_before_ftc IS NULL OR thai_tax_before_ftc >= 0),
  thai_tax_provenance text,
  thai_tax_confirmed_at timestamptz,
  thai_tax_confirmed_input_fingerprint text,
  draft jsonb NOT NULL,
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  assigned_officer_id uuid REFERENCES app_users(id) ON DELETE RESTRICT,
  submitted_snapshot_id uuid,
  submitted_at timestamptz,
  create_request_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, create_request_id),
  UNIQUE (id, owner_id),
  CHECK ((status = 'draft' AND submitted_at IS NULL AND submitted_snapshot_id IS NULL) OR
         (status = 'submitted' AND submitted_at IS NOT NULL AND submitted_snapshot_id IS NOT NULL))
);
CREATE INDEX ftc_cases_owner_updated_idx ON ftc_cases(owner_id, updated_at DESC);
CREATE INDEX ftc_cases_officer_status_submitted_idx ON ftc_cases(assigned_officer_id, status, submitted_at DESC);

CREATE TABLE foreign_income_sources (
  id uuid PRIMARY KEY,
  case_id uuid NOT NULL REFERENCES ftc_cases(id) ON DELETE RESTRICT,
  position integer NOT NULL CHECK (position BETWEEN 0 AND 19),
  country_code text,
  country_name text,
  income_type text CHECK (income_type IS NULL OR income_type IN ('salary_40_1', 'dividend_40_4', 'other')),
  subtype text,
  earned_tax_year integer,
  earned_date date,
  residence_days_in_earned_year integer CHECK (residence_days_in_earned_year IS NULL OR residence_days_in_earned_year BETWEEN 0 AND 365),
  input_mode text CHECK (input_mode IS NULL OR input_mode IN ('worksheet_thb', 'original_currency')),
  gross_income_amount numeric(30,12) CHECK (gross_income_amount IS NULL OR gross_income_amount >= 0),
  currency_code text,
  gross_income_thb numeric(30,12) CHECK (gross_income_thb IS NULL OR gross_income_thb >= 0),
  actual_foreign_tax_paid numeric(30,12) CHECK (actual_foreign_tax_paid IS NULL OR actual_foreign_tax_paid >= 0),
  actual_foreign_tax_paid_thb numeric(30,12) CHECK (actual_foreign_tax_paid_thb IS NULL OR actual_foreign_tax_paid_thb >= 0),
  eligible_foreign_tax numeric(30,12) CHECK (eligible_foreign_tax IS NULL OR eligible_foreign_tax >= 0),
  eligible_foreign_tax_thb numeric(30,12) CHECK (eligible_foreign_tax_thb IS NULL OR eligible_foreign_tax_thb >= 0),
  eligibility_rationale text,
  eligibility_confirmed_at timestamptz,
  eligibility_confirmed_input_fingerprint text,
  remitted_income_amount numeric(30,12) CHECK (remitted_income_amount IS NULL OR remitted_income_amount >= 0),
  remitted_income_thb numeric(30,12) CHECK (remitted_income_thb IS NULL OR remitted_income_thb >= 0),
  fx_reference jsonb,
  unsupported_classification text,
  unsupported_explanation text,
  source_data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (case_id, id)
);
CREATE INDEX foreign_income_sources_case_idx ON foreign_income_sources(case_id);

CREATE FUNCTION enforce_source_case_limit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' AND (SELECT count(*) FROM foreign_income_sources WHERE case_id=NEW.case_id) >= 20 THEN
    RAISE EXCEPTION 'case source limit reached' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER foreign_income_sources_limit BEFORE INSERT ON foreign_income_sources FOR EACH ROW EXECUTE FUNCTION enforce_source_case_limit();

CREATE TABLE remittances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL,
  source_id uuid NOT NULL UNIQUE,
  remittance_date date,
  transfer_total_amount numeric(30,12) CHECK (transfer_total_amount IS NULL OR transfer_total_amount >= 0),
  transfer_currency_code text,
  transfer_total_thb numeric(30,12) CHECK (transfer_total_thb IS NULL OR transfer_total_thb >= 0),
  classification text,
  classification_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (case_id, source_id) REFERENCES foreign_income_sources(case_id, id) ON DELETE RESTRICT,
  UNIQUE (case_id, id)
);
CREATE INDEX remittances_case_idx ON remittances(case_id);

CREATE TABLE exchange_rate_references (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL,
  source_id uuid NOT NULL UNIQUE,
  currency_code text,
  thb_rate numeric(18,8) CHECK (thb_rate IS NULL OR thb_rate > 0),
  base_units integer CHECK (base_units IS NULL OR base_units IN (1, 100)),
  effective_date date,
  rate_type text,
  source_kind text,
  source_label text,
  source_url text,
  educational_assumption text,
  FOREIGN KEY (case_id, source_id) REFERENCES foreign_income_sources(case_id, id) ON DELETE RESTRICT
);

CREATE TABLE officer_case_assignments (
  case_id uuid NOT NULL REFERENCES ftc_cases(id) ON DELETE RESTRICT,
  officer_id uuid NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  assigned_by uuid REFERENCES app_users(id) ON DELETE RESTRICT,
  PRIMARY KEY (case_id, officer_id)
);

CREATE TABLE attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES ftc_cases(id) ON DELETE RESTRICT,
  source_id uuid,
  remittance_id uuid,
  storage_environment text NOT NULL CHECK (storage_environment IN ('production', 'preview', 'local')),
  storage_store text NOT NULL CHECK (length(storage_store) BETWEEN 1 AND 64 AND storage_store !~ '[/ :]'),
  storage_region text NOT NULL CHECK (storage_region IN ('ap-southeast-1', 'ap-southeast-2', 'eu-central-1', 'us-east-2')),
  storage_key text NOT NULL UNIQUE,
  display_name text NOT NULL,
  media_type text NOT NULL,
  byte_size integer NOT NULL CHECK (byte_size >= 0),
  sha256 text NOT NULL,
  kind text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'ready', 'failed', 'deleted')),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (case_id, source_id) REFERENCES foreign_income_sources(case_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (case_id, remittance_id) REFERENCES remittances(case_id, id) ON DELETE RESTRICT,
  UNIQUE (case_id, id)
);
CREATE INDEX attachments_case_idx ON attachments(case_id);

CREATE TABLE rule_sets (
  id text PRIMARY KEY,
  tax_year integer NOT NULL,
  effective_from date,
  effective_to date,
  source_urls jsonb NOT NULL DEFAULT '[]'::jsonb,
  reviewed_at timestamptz,
  assumptions jsonb NOT NULL DEFAULT '[]'::jsonb,
  rounding_policy text NOT NULL
);

CREATE TABLE calculation_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES ftc_cases(id) ON DELETE RESTRICT,
  revision integer NOT NULL,
  kind text NOT NULL CHECK (kind IN ('preview', 'submitted')),
  inputs jsonb NOT NULL,
  result jsonb NOT NULL,
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  policy jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (case_id, id)
);
CREATE UNIQUE INDEX one_submitted_snapshot_per_case ON calculation_snapshots(case_id) WHERE kind = 'submitted';
ALTER TABLE ftc_cases ADD CONSTRAINT ftc_cases_submitted_snapshot_fk
  FOREIGN KEY (id, submitted_snapshot_id) REFERENCES calculation_snapshots(case_id, id) ON DELETE RESTRICT;

CREATE TABLE audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  case_id uuid REFERENCES ftc_cases(id) ON DELETE RESTRICT,
  snapshot_id uuid,
  event_type text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  FOREIGN KEY (case_id, snapshot_id) REFERENCES calculation_snapshots(case_id, id) ON DELETE RESTRICT
);
CREATE INDEX audit_events_case_time_idx ON audit_events(case_id, occurred_at DESC);

CREATE TABLE api_mutation_requests (
  case_id uuid NOT NULL REFERENCES ftc_cases(id) ON DELETE RESTRICT,
  request_id text NOT NULL,
  operation text NOT NULL,
  request_digest text NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (case_id, operation, request_id)
);

CREATE FUNCTION protect_case_state() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'submitted' THEN RAISE EXCEPTION 'submitted cases are immutable' USING ERRCODE = '55000'; END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'submitted' THEN RAISE EXCEPTION 'submitted cases are immutable' USING ERRCODE = '55000'; END IF;
  IF NEW.status NOT IN ('draft', 'submitted') OR (OLD.status = 'submitted' AND NEW.status <> 'submitted') THEN
    RAISE EXCEPTION 'invalid case state transition' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER ftc_cases_state_guard BEFORE UPDATE OR DELETE ON ftc_cases FOR EACH ROW EXECUTE FUNCTION protect_case_state();

CREATE FUNCTION protect_child_after_submission() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE case_key uuid;
BEGIN
  case_key := CASE WHEN TG_OP = 'DELETE' THEN OLD.case_id ELSE NEW.case_id END;
  IF EXISTS (SELECT 1 FROM ftc_cases WHERE id = case_key AND status = 'submitted') OR
     (TG_OP = 'UPDATE' AND EXISTS (SELECT 1 FROM ftc_cases WHERE id = OLD.case_id AND status = 'submitted')) THEN
    RAISE EXCEPTION 'submitted case records are immutable' USING ERRCODE = '55000';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER foreign_income_sources_state_guard BEFORE INSERT OR UPDATE OR DELETE ON foreign_income_sources FOR EACH ROW EXECUTE FUNCTION protect_child_after_submission();
CREATE TRIGGER remittances_state_guard BEFORE INSERT OR UPDATE OR DELETE ON remittances FOR EACH ROW EXECUTE FUNCTION protect_child_after_submission();
CREATE TRIGGER exchange_rate_references_state_guard BEFORE INSERT OR UPDATE OR DELETE ON exchange_rate_references FOR EACH ROW EXECUTE FUNCTION protect_child_after_submission();
CREATE TRIGGER attachments_state_guard BEFORE INSERT OR UPDATE OR DELETE ON attachments FOR EACH ROW EXECUTE FUNCTION protect_child_after_submission();

CREATE FUNCTION require_assigned_officer_role() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.assigned_officer_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM app_users WHERE id=NEW.assigned_officer_id AND role='officer' AND active=true
  ) THEN
    RAISE EXCEPTION 'assigned user must be an active officer' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER ftc_cases_officer_role_guard BEFORE INSERT OR UPDATE OF assigned_officer_id ON ftc_cases FOR EACH ROW EXECUTE FUNCTION require_assigned_officer_role();

CREATE FUNCTION require_assignment_officer_role() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM app_users WHERE id=NEW.officer_id AND role='officer' AND active=true) THEN
    RAISE EXCEPTION 'assigned user must be an active officer' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER officer_assignments_role_guard BEFORE INSERT OR UPDATE ON officer_case_assignments FOR EACH ROW EXECUTE FUNCTION require_assignment_officer_role();

CREATE FUNCTION prevent_immutable_record_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'record is immutable' USING ERRCODE = '55000';
END $$;
CREATE TRIGGER snapshots_immutable BEFORE UPDATE OR DELETE ON calculation_snapshots FOR EACH ROW EXECUTE FUNCTION prevent_immutable_record_change();
CREATE TRIGGER audit_events_immutable BEFORE UPDATE OR DELETE ON audit_events FOR EACH ROW EXECUTE FUNCTION prevent_immutable_record_change();
