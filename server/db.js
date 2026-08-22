// SQLite storage layer, built on Node's built-in node:sqlite (no native
// module to compile — matters for this being a small self-hosted app that
// needs to build cleanly on whatever architecture a home server runs,
// Raspberry Pi included, without a C++ toolchain in the image).
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'squadboard.db'));
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS kv_settings (
    key   TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS players (
    player_id        INTEGER PRIMARY KEY,
    team_id          INTEGER NOT NULL,
    first_name       TEXT,
    last_name        TEXT,
    nickname         TEXT,
    age_years        INTEGER,
    age_days         INTEGER,
    date_of_birth    TEXT,
    position_code    TEXT,
    specialty        TEXT,
    tsi              INTEGER,
    salary           INTEGER,
    form             INTEGER,
    experience       INTEGER,
    leadership       INTEGER,
    skill_keeper     INTEGER,
    skill_defending  INTEGER,
    skill_playmaking INTEGER,
    skill_winger     INTEGER,
    skill_passing    INTEGER,
    skill_scoring    INTEGER,
    skill_setpieces  INTEGER,
    skill_stamina    INTEGER,
    training_focus   TEXT,
    injury_weeks     INTEGER DEFAULT 0,
    suspension_weeks INTEGER DEFAULT 0,
    transfer_listed  INTEGER DEFAULT 0,
    contract_expiry  TEXT,
    value_estimate   INTEGER,
    is_active        INTEGER DEFAULT 1,
    updated_at       TEXT
  );

  CREATE TABLE IF NOT EXISTS player_snapshots (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id         INTEGER NOT NULL REFERENCES players(player_id) ON DELETE CASCADE,
    snapshot_date     TEXT NOT NULL,
    tsi               INTEGER,
    value_estimate    INTEGER,
    form              INTEGER,
    salary            INTEGER,
    injury_weeks      INTEGER DEFAULT 0,
    skill_keeper      INTEGER,
    skill_defending   INTEGER,
    skill_playmaking  INTEGER,
    skill_winger      INTEGER,
    skill_passing     INTEGER,
    skill_scoring     INTEGER,
    skill_setpieces   INTEGER,
    skill_stamina     INTEGER,
    UNIQUE(player_id, snapshot_date)
  );

  CREATE TABLE IF NOT EXISTS team_snapshots (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    snapshot_date   TEXT NOT NULL UNIQUE,
    team_id         INTEGER,
    team_tsi        INTEGER,
    team_worth      INTEGER,
    cash            INTEGER,
    weekly_income   INTEGER,
    weekly_expenses INTEGER
  );

  CREATE TABLE IF NOT EXISTS sync_log (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    ran_at   TEXT NOT NULL,
    kind     TEXT NOT NULL,
    status   TEXT NOT NULL,
    message  TEXT
  );
`);

function getSetting(key, fallback = null) {
  const row = db.prepare('SELECT value FROM kv_settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

function setSetting(key, value) {
  db.prepare(
    `INSERT INTO kv_settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, value == null ? null : String(value));
}

function deleteSetting(key) {
  db.prepare('DELETE FROM kv_settings WHERE key = ?').run(key);
}

function getAllSettings() {
  const rows = db.prepare('SELECT key, value FROM kv_settings').all();
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

/** node:sqlite has no built-in transaction() helper (unlike better-sqlite3) — this wraps BEGIN/COMMIT/ROLLBACK. */
function withTransaction(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

module.exports = { db, getSetting, setSetting, deleteSetting, getAllSettings, withTransaction, DATA_DIR };
