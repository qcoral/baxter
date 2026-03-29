import { NextResponse } from 'next/server';
import { getAllReviews, upsertReview, deleteReview } from '@/lib/db';

export async function GET() {
  console.log('[GET /api/reviews] fetching all reviews');
  const reviews = getAllReviews();
  console.log(`[GET /api/reviews] returning ${reviews.length} reviews`);
  return NextResponse.json(reviews);
}

export async function DELETE(req: Request) {
  try {
    const { recordId } = await req.json();
    if (!recordId) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    console.log(`[DELETE /api/reviews] record_id=${recordId}`);
    deleteReview(recordId);
    console.log(`[DELETE /api/reviews] done record_id=${recordId}`);
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
    console.log(`[POST /api/reviews] record_id=${recordId} status=${status} reviewer=${reviewerId ?? 'null'}`);
    upsertReview(recordId, status, notes ?? '', reviewerId ?? null);
    console.log(`[POST /api/reviews] done record_id=${recordId}`);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[POST /api/reviews]', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
