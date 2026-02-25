import Database from 'better-sqlite3';
import path from 'path';

let db: ReturnType<typeof Database> | null = null;

function getDb() {
  if (!db) {
    db = new Database(process.env.DB_PATH ?? path.join(process.cwd(), 'reviews.db'));
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
