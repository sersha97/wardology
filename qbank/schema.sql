-- Wardology QBank database (Cloudflare D1)
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT '',
  pw_hash TEXT NOT NULL,
  pw_salt TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  expires INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS tests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  mode TEXT NOT NULL,            -- 'tutor' | 'exam'
  timed INTEGER NOT NULL DEFAULT 0,
  time_limit INTEGER NOT NULL DEFAULT 0,  -- seconds, 0 = untimed
  elapsed INTEGER NOT NULL DEFAULT 0,     -- seconds used
  status TEXT NOT NULL DEFAULT 'active',  -- 'active' | 'suspended' | 'done'
  current_idx INTEGER NOT NULL DEFAULT 0,
  categories TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  finished_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_tests_user ON tests(user_id);

CREATE TABLE IF NOT EXISTS test_items (
  test_id INTEGER NOT NULL,
  idx INTEGER NOT NULL,
  qid TEXT NOT NULL,
  choice TEXT,
  first_choice TEXT,
  correct INTEGER,          -- 1 / 0 / NULL (not graded yet)
  marked INTEGER NOT NULL DEFAULT 0,
  revealed INTEGER NOT NULL DEFAULT 0,
  seconds INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (test_id, idx)
);

CREATE TABLE IF NOT EXISTS user_q (
  user_id INTEGER NOT NULL,
  qid TEXT NOT NULL,
  status TEXT NOT NULL,     -- 'correct' | 'incorrect' | 'omitted'
  marked INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  first_correct INTEGER,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, qid)
);

-- first-attempt answer counts per choice (drives "% of people who chose this")
CREATE TABLE IF NOT EXISTS q_stats (
  qid TEXT NOT NULL,
  choice TEXT NOT NULL,
  n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (qid, choice)
);

CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  qid TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
