import Database from 'better-sqlite3';
import path from 'path';

let db: ReturnType<typeof Database> | null = null;

function getDb() {
  if (!db) {
    db = new Database(process.env.DB_PATH ?? path.join(process.cwd(), 'reviews.db'));
    db.pragma('journal_mode = WAL');
    db.pragma('busy_timeout = 5000');
    db.exec(`
      CREATE TABLE IF NOT EXISTS reviews (
        record_id TEXT PRIMARY KEY,
        status TEXT CHECK(status IN ('good', 'minor_issue', 'major_issue')) NOT NULL,
        notes TEXT NOT NULL DEFAULT '',
        reviewed_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);

    // Migration 1: Migrate from old schema if it has 'issue' instead of 'minor_issue'/'major_issue'
    const tableDef = (
      db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='reviews'")
        .get() as { sql: string } | undefined
    )?.sql ?? '';

    if (tableDef.includes("'issue'") && !tableDef.includes("'minor_issue'")) {
      db.exec(`
        ALTER TABLE reviews RENAME TO reviews_old;
        CREATE TABLE reviews (
          record_id TEXT PRIMARY KEY,
          status TEXT CHECK(status IN ('good', 'minor_issue', 'major_issue')) NOT NULL,
          notes TEXT NOT NULL DEFAULT '',
          reviewed_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        INSERT INTO reviews
          SELECT record_id,
            CASE status WHEN 'issue' THEN 'major_issue' ELSE status END,
            notes, reviewed_at
          FROM reviews_old;
        DROP TABLE reviews_old;
      `);
    }

    // Migration 2: Add reviewer_id column if missing
    const reviewsTableDef = (
      db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='reviews'")
        .get() as { sql: string } | undefined
    )?.sql ?? '';

    if (!reviewsTableDef.includes('reviewer_id')) {
      db.exec(`ALTER TABLE reviews ADD COLUMN reviewer_id TEXT REFERENCES reviewers(id)`);
    }

    // Create reviewers table
    db.exec(`
      CREATE TABLE IF NOT EXISTS reviewers (
        id TEXT PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);

    // Create ai_flags table
    db.exec(`
      CREATE TABLE IF NOT EXISTS ai_flags (
        record_id TEXT PRIMARY KEY,
        flagged INTEGER NOT NULL,
        reason TEXT NOT NULL DEFAULT '',
        model TEXT NOT NULL,
        flagged_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);

    // Create api_cache table
    db.exec(`
      CREATE TABLE IF NOT EXISTS api_cache (
        key TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        cached_at INTEGER NOT NULL
      )
    `);
  }
  return db;
}

export interface Review {
  record_id: string;
  status: 'good' | 'minor_issue' | 'major_issue';
  notes: string;
  reviewed_at: string;
  reviewer_id: string | null;
}

export interface Reviewer {
  id: string;
  name: string;
  created_at: string;
}

export function getAllReviews(): Review[] {
  return getDb().prepare('SELECT * FROM reviews').all() as Review[];
}

export function deleteReview(recordId: string): void {
  getDb().prepare('DELETE FROM reviews WHERE record_id = ?').run(recordId);
}

export function upsertReview(
  recordId: string,
  status: 'good' | 'minor_issue' | 'major_issue',
  notes: string,
  reviewerId?: string | null
): void {
  getDb()
    .prepare(
      `INSERT INTO reviews (record_id, status, notes, reviewed_at, reviewer_id)
       VALUES (?, ?, ?, datetime('now'), ?)
       ON CONFLICT(record_id) DO UPDATE SET
         status = excluded.status,
         notes = excluded.notes,
         reviewed_at = datetime('now'),
         reviewer_id = excluded.reviewer_id`
    )
    .run(recordId, status, notes, reviewerId ?? null);
}

export function getAllReviewers(): Reviewer[] {
  return getDb().prepare('SELECT * FROM reviewers ORDER BY created_at ASC').all() as Reviewer[];
}

export function getReviewerByName(name: string): Reviewer | null {
  return (
    (getDb().prepare('SELECT * FROM reviewers WHERE name = ?').get(name) as Reviewer | undefined) ??
    null
  );
}

export function createReviewer(id: string, name: string): Reviewer {
  getDb()
    .prepare(`INSERT INTO reviewers (id, name) VALUES (?, ?)`)
    .run(id, name);
  return getDb().prepare('SELECT * FROM reviewers WHERE id = ?').get(id) as Reviewer;
}

// ── AI Flags ──────────────────────────────────────────────────────────────────

export interface AiFlag {
  record_id: string;
  flagged: number; // 1 = flagged, 0 = clean
  reason: string;
  model: string;
  flagged_at: string;
}

export function getAllAiFlags(): AiFlag[] {
  return getDb().prepare('SELECT * FROM ai_flags').all() as AiFlag[];
}

export function getProcessedRecordIds(): Set<string> {
  const rows = getDb().prepare('SELECT record_id FROM ai_flags').all() as { record_id: string }[];
  return new Set(rows.map((r) => r.record_id));
}

export function deleteAiFlagsByType(flagged: boolean): void {
  getDb()
    .prepare('DELETE FROM ai_flags WHERE flagged = ?')
    .run(flagged ? 1 : 0);
}

export function upsertAiFlag(
  recordId: string,
  flagged: boolean,
  reason: string,
  model: string
): void {
  getDb()
    .prepare(
      `INSERT INTO ai_flags (record_id, flagged, reason, model, flagged_at)
       VALUES (?, ?, ?, ?, datetime('now'))
       ON CONFLICT(record_id) DO UPDATE SET
         flagged = excluded.flagged,
         reason = excluded.reason,
         model = excluded.model,
         flagged_at = datetime('now')`
    )
    .run(recordId, flagged ? 1 : 0, reason, model);
}

// ── API Cache ─────────────────────────────────────────────────────────────────

export function getApiCache(key: string): { data: string; cachedAt: number } | null {
  const row = getDb()
    .prepare('SELECT data, cached_at FROM api_cache WHERE key = ?')
    .get(key) as { data: string; cached_at: number } | undefined;
  return row ? { data: row.data, cachedAt: row.cached_at } : null;
}

export function setApiCache(key: string, data: string): void {
  getDb()
    .prepare(
      `INSERT INTO api_cache (key, data, cached_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET data = excluded.data, cached_at = excluded.cached_at`
    )
    .run(key, data, Date.now());
}

export function deleteApiCache(key: string): void {
  getDb().prepare('DELETE FROM api_cache WHERE key = ?').run(key);
}
