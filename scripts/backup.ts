/**
 * Hot backup of the reviews SQLite database.
 * Uses better-sqlite3's .backup() which is safe against concurrent writes.
 *
 * Usage:
 *   npm run backup
 *   BACKUP_DIR=/my/path npm run backup
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const dbPath = process.env.DB_PATH ?? path.join(process.cwd(), 'reviews.db');
const backupDir = process.env.BACKUP_DIR ?? path.join(process.cwd(), 'backups');

fs.mkdirSync(backupDir, { recursive: true });

const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const destPath = path.join(backupDir, `reviews-${timestamp}.db`);

const db = new Database(dbPath, { readonly: true });
db.backup(destPath)
  .then(() => {
    console.log(`Backup saved to ${destPath}`);
    db.close();
  })
  .catch((err: Error) => {
    console.error('Backup failed:', err.message);
    db.close();
    process.exit(1);
  });
