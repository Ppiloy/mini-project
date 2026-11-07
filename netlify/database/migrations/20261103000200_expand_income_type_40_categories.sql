ALTER TABLE foreign_income_sources
  DROP CONSTRAINT foreign_income_sources_income_type_check;

ALTER TABLE foreign_income_sources
  ADD CONSTRAINT foreign_income_sources_income_type_check
  CHECK (income_type IS NULL OR income_type IN (
    'salary_40_1',
    'service_40_2',
    'rights_40_3',
    'dividend_40_4',
    'investment_40_4',
    'property_40_5',
    'professional_40_6',
    'contract_40_7',
    'business_40_8',
    'other'
  ));
