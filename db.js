const { Pool } = require('pg');
const crypto = require('node:crypto');

if (!process.env.DATABASE_URL) {
  console.error('\n[DB] DATABASE_URL 환경 변수가 없습니다.');
  console.error('[DB] Render > Environment에 Supabase Session pooler URI를 DATABASE_URL로 등록해 주세요.\n');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

pool.on('error', (err) => {
  console.error('[DB] PostgreSQL pool error:', err);
});

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS classes (
      id text PRIMARY KEY,
      grade integer NOT NULL CHECK (grade BETWEEN 1 AND 6),
      class_number integer NOT NULL CHECK (class_number BETWEEN 1 AND 30),
      pin_hash text NOT NULL,
      selected_missions jsonb NOT NULL DEFAULT '["time","pages"]'::jsonb,
      total_minutes integer NOT NULL DEFAULT 0,
      total_pages integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (grade, class_number)
    );

    CREATE TABLE IF NOT EXISTS records (
      id uuid PRIMARY KEY,
      class_id text NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
      type text NOT NULL CHECK (type IN ('time', 'pages')),
      amount integer NOT NULL CHECK (amount > 0),
      book_title text,
      student_name text,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token text PRIMARY KEY,
      class_id text NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS records_class_id_idx ON records(class_id);
    CREATE INDEX IF NOT EXISTS records_created_at_idx ON records(created_at DESC);
    CREATE INDEX IF NOT EXISTS sessions_class_id_idx ON sessions(class_id);
  `);
}

function hashPin(pin) {
  const salt = '7942_reading_salt_2026';
  return crypto.createHash('sha256').update(pin + salt).digest('hex');
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function formatClassId(grade, classNumber) {
  return `${grade}-${classNumber}`;
}

module.exports = {
  pool,
  initDb,
  hashPin,
  generateToken,
  formatClassId
};
