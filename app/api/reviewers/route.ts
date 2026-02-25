import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { getAllReviewers, getReviewerByName, createReviewer } from '@/lib/db';

export async function GET() {
  return NextResponse.json(getAllReviewers());
}

export async function POST(req: Request) {
  try {
    const { name } = await req.json();
    if (!name || typeof name !== 'string' || !name.trim()) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    }
    const trimmed = name.trim();
    const existing = getReviewerByName(trimmed);
    if (existing) return NextResponse.json({ reviewer: existing });
    const reviewer = createReviewer(randomUUID(), trimmed);
    return NextResponse.json({ reviewer });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
