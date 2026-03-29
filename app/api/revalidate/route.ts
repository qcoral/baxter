import { NextResponse } from 'next/server';
import { invalidateProjectsCache } from '@/lib/airtable';

export async function POST() {
  console.log('[POST /api/revalidate] invalidating projects cache');
  invalidateProjectsCache();
  return NextResponse.json({ ok: true });
}
