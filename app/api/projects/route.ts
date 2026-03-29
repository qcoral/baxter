import { NextResponse } from 'next/server';
import { fetchAllProjects } from '@/lib/airtable';
import { getAllReviews } from '@/lib/db';

export async function GET() {
  try {
    const projects = await fetchAllProjects();
    const reviews = getAllReviews();
    const reviewMap = new Map(reviews.map((r) => [r.record_id, r]));
    const enriched = projects.map((p) => ({ ...p, review: reviewMap.get(p.id) ?? null }));
    const matched = enriched.filter((p) => p.review !== null).length;
    console.log(`[GET /api/projects] ${projects.length} projects, ${reviews.length} reviews in db, ${matched} matched`);
    return NextResponse.json(enriched);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
