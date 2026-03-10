import { NextResponse } from 'next/server';
import { getAllReviews, upsertReview, deleteReview } from '@/lib/db';

export async function GET() {
  return NextResponse.json(getAllReviews());
}

export async function DELETE(req: Request) {
  try {
    const { recordId } = await req.json();
    if (!recordId) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    deleteReview(recordId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[DELETE /api/reviews]', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const { recordId, status, notes, reviewerId } = await req.json();
    if (!recordId || !['good', 'minor_issue', 'major_issue'].includes(status)) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    }
    upsertReview(recordId, status, notes ?? '', reviewerId ?? null);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[POST /api/reviews]', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
