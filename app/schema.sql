
-- MYNOTES: estrutura inicial do banco

-- Usuários
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  display_name TEXT,
  email_verified INTEGER NOT NULL DEFAULT 0
    CHECK (email_verified IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Identidades de autenticação
CREATE TABLE IF NOT EXISTS auth_identities (
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL
    CHECK (provider IN ('google', 'password')),
  provider_subject TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (provider, provider_subject),
  UNIQUE (user_id, provider),
  FOREIGN KEY (user_id) REFERENCES users(id)
    ON DELETE CASCADE
);

-- Senhas: somente hashes seguros
CREATE TABLE IF NOT EXISTS password_credentials (
  user_id TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
    ON DELETE CASCADE
);

-- Sessões autenticadas
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sessions_user
ON sessions(user_id);

-- Confirmação de e-mail e recuperação de senha
CREATE TABLE IF NOT EXISTS email_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  purpose TEXT NOT NULL
    CHECK (purpose IN ('verify_email', 'reset_password')),
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  FOREIGN KEY (user_id) REFERENCES users(id)
    ON DELETE CASCADE
);

-- Cadernos
CREATE TABLE IF NOT EXISTS notebooks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT,
  UNIQUE (id, user_id),
  FOREIGN KEY (user_id) REFERENCES users(id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_notebooks_user
ON notebooks(user_id);

-- Seções
CREATE TABLE IF NOT EXISTS sections (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  notebook_id TEXT NOT NULL,
  title TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT,
  UNIQUE (id, user_id),
  FOREIGN KEY (notebook_id, user_id)
    REFERENCES notebooks(id, user_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sections_notebook
ON sections(notebook_id, user_id);

-- Páginas e anotações
CREATE TABLE IF NOT EXISTS pages (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  section_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT 'Nova anotação',
  content_json TEXT NOT NULL
    DEFAULT '{"type":"doc","content":[]}',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT,
  FOREIGN KEY (section_id, user_id)
    REFERENCES sections(id, user_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_pages_section
ON pages(section_id, user_id);

CREATE INDEX IF NOT EXISTS idx_pages_user
ON pages(user_id);
