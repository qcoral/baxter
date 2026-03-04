import { NextResponse } from 'next/server';
import { invalidateProjectsCache } from '@/lib/airtable';

export async function POST() {
  invalidateProjectsCache();
  return NextResponse.json({ ok: true });
}
