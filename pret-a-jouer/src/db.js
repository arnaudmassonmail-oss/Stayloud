import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function openDb(file) {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      pass_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      lat REAL,
      lng REAL,
      city TEXT DEFAULT '',
      bio TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS toys (
      id INTEGER PRIMARY KEY,
      owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      category TEXT NOT NULL,
      age_min INTEGER NOT NULL DEFAULT 0,
      age_max INTEGER NOT NULL DEFAULT 12,
      condition TEXT NOT NULL DEFAULT 'bon',
      deposit INTEGER NOT NULL DEFAULT 0,
      max_days INTEGER NOT NULL DEFAULT 14,
      photo TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS loans (
      id INTEGER PRIMARY KEY,
      toy_id INTEGER NOT NULL REFERENCES toys(id) ON DELETE CASCADE,
      borrower_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY,
      loan_id INTEGER NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
      sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS reviews (
      id INTEGER PRIMARY KEY,
      loan_id INTEGER NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
      author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      target_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
      comment TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (loan_id, author_id)
    );

    CREATE INDEX IF NOT EXISTS idx_toys_owner ON toys(owner_id);
    CREATE INDEX IF NOT EXISTS idx_loans_toy ON loans(toy_id);
    CREATE INDEX IF NOT EXISTS idx_users_pos ON users(lat, lng);
  `);
  return db;
}
