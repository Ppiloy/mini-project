ALTER TABLE foreign_income_sources
  DROP CONSTRAINT foreign_income_sources_residence_days_in_earned_year_check;

ALTER TABLE foreign_income_sources
  ADD CONSTRAINT foreign_income_sources_residence_days_in_earned_year_check
  CHECK (residence_days_in_earned_year IS NULL OR residence_days_in_earned_year BETWEEN 0 AND 366);
