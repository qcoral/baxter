import { NextResponse } from 'next/server';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

export async function GET() {
  const dbPath = process.env.DB_PATH ?? path.join(process.cwd(), 'reviews.db');
  const backupPath = path.join('/tmp', `backup-${Date.now()}.db`);

  try {
    const db = new Database(dbPath, { readonly: true });
    await db.backup(backupPath);
    db.close();

    const data = fs.readFileSync(backupPath);
    fs.unlinkSync(backupPath);

    return new NextResponse(data, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="baxter-backup-${new Date().toISOString().slice(0, 10)}.db"`,
      },
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
