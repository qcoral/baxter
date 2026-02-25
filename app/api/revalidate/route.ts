import { revalidateTag } from 'next/cache';
import { NextResponse } from 'next/server';

export async function POST() {
  revalidateTag('airtable-projects');
  return NextResponse.json({ ok: true });
}
