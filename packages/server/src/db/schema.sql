PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS applications (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  organization TEXT NOT NULL,
  type TEXT NOT NULL,
  deadline TEXT,
  notes TEXT,
  readiness_score INTEGER,
  readiness_status TEXT,
  last_analyzed_at TEXT,
  is_demo INTEGER NOT NULL DEFAULT 0,
  demo_step INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS requirement_sources (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL,
  source_name TEXT NOT NULL,
  source_url TEXT,
  extracted_text_preview TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS requirements (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  source_id TEXT REFERENCES requirement_sources(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL,
  required INTEGER NOT NULL DEFAULT 1,
  conditional INTEGER NOT NULL DEFAULT 0,
  condition_text TEXT,
  source_type TEXT,
  source_name TEXT,
  source_url TEXT,
  source_evidence TEXT NOT NULL,
  source_location TEXT,
  confidence REAL NOT NULL DEFAULT 0.5,
  confidence_level TEXT NOT NULL DEFAULT 'medium',
  extraction_rule TEXT,
  user_confirmed INTEGER NOT NULL DEFAULT 0,
  accepted_document_types TEXT NOT NULL DEFAULT '[]',
  accepted_file_extensions TEXT NOT NULL DEFAULT '[]',
  minimum_count INTEGER NOT NULL DEFAULT 1,
  maximum_count INTEGER,
  word_limit_minimum INTEGER,
  word_limit_maximum INTEGER,
  page_limit_minimum INTEGER,
  page_limit_maximum INTEGER,
  filename_pattern TEXT,
  signature_required INTEGER NOT NULL DEFAULT 0,
  date_requirement TEXT,
  expiration_rule TEXT,
  required_keywords TEXT NOT NULL DEFAULT '[]',
  organization_name_expected TEXT,
  custom_validation_notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  application_id TEXT REFERENCES applications(id) ON DELETE CASCADE,
  vault_document_id TEXT,
  original_filename TEXT NOT NULL,
  stored_filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  page_count INTEGER,
  word_count INTEGER,
  title TEXT,
  category TEXT,
  category_confidence REAL,
  parse_status TEXT NOT NULL,
  parsing_warnings TEXT NOT NULL DEFAULT '[]',
  content_hash TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS document_text (
  document_id TEXT PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
  text_content TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS document_facts (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  fact_type TEXT NOT NULL,
  value TEXT NOT NULL,
  evidence TEXT,
  confidence REAL NOT NULL DEFAULT 0.5
);

CREATE TABLE IF NOT EXISTS document_matches (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  requirement_id TEXT NOT NULL REFERENCES requirements(id) ON DELETE CASCADE,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  confidence REAL NOT NULL,
  explanation TEXT NOT NULL,
  evidence TEXT NOT NULL DEFAULT '[]',
  user_confirmed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(requirement_id, document_id)
);

CREATE TABLE IF NOT EXISTS validation_results (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  requirement_id TEXT REFERENCES requirements(id) ON DELETE CASCADE,
  document_id TEXT REFERENCES documents(id) ON DELETE CASCADE,
  rule TEXT NOT NULL,
  passed INTEGER NOT NULL,
  severity TEXT NOT NULL,
  message TEXT NOT NULL,
  evidence TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS issues (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  requirement_id TEXT REFERENCES requirements(id) ON DELETE SET NULL,
  document_id TEXT REFERENCES documents(id) ON DELETE SET NULL,
  severity TEXT NOT NULL,
  code TEXT NOT NULL,
  title TEXT NOT NULL,
  explanation TEXT NOT NULL,
  evidence TEXT,
  recommended_fix TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  dismissible INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS applicant_profiles (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL UNIQUE REFERENCES applications(id) ON DELETE CASCADE,
  full_legal_name TEXT,
  preferred_name TEXT,
  email TEXT,
  phone TEXT,
  school TEXT,
  expected_graduation_date TEXT,
  major TEXT,
  gpa TEXT,
  address TEXT,
  target_organization TEXT,
  user_confirmed INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS profile_conflicts (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  field TEXT NOT NULL,
  values_json TEXT NOT NULL,
  resolved INTEGER NOT NULL DEFAULT 0,
  equivalent INTEGER,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS vault_documents (
  id TEXT PRIMARY KEY,
  original_filename TEXT NOT NULL,
  stored_filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  category TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  expiration_date TEXT,
  word_count INTEGER,
  page_count INTEGER,
  extracted_summary TEXT,
  parse_status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS activity_events (
  id TEXT PRIMARY KEY,
  application_id TEXT REFERENCES applications(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  message TEXT NOT NULL,
  metadata TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_requirements_app ON requirements(application_id);
CREATE INDEX IF NOT EXISTS idx_documents_app ON documents(application_id);
CREATE INDEX IF NOT EXISTS idx_issues_app ON issues(application_id);
CREATE INDEX IF NOT EXISTS idx_matches_app ON document_matches(application_id);
