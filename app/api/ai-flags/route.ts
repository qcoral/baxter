import { NextResponse } from 'next/server';
import { getAllAiFlags, getProcessedRecordIds, deleteAiFlagsByType } from '@/lib/db';
import { fetchAllProjects } from '@/lib/airtable';
import { runAiReview } from '@/lib/ai-review';

export async function GET() {
  const flags = getAllAiFlags();
  const projects = await fetchAllProjects();
  const projectMap = new Map(projects.map((p) => [p.id, p]));

  const enriched = flags.map((f) => {
    const p = projectMap.get(f.record_id);
    return {
      ...f,
      justification: p?.fields['Override Hours Spent Justification'] ?? null,
      first_name: p?.fields['First Name'] ?? null,
      last_name: p?.fields['Last Name'] ?? null,
      hours: p?.fields['Override Hours Spent'] ?? null,
      program: p?.fields['YSWS–Name']?.[0] ?? null,
    };
  });

  return NextResponse.json(enriched);
}

// Body: {} | { refresh: 'flagged' | 'pass' }
export async function POST(req: Request) {
  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json({ error: 'ANTHROPIC_API_KEY is not set' }, { status: 500 });
    }

    const body = await req.json().catch(() => ({}));
    if (body.refresh === 'flagged') deleteAiFlagsByType(true);
    else if (body.refresh === 'pass') deleteAiFlagsByType(false);

    const projects = await fetchAllProjects();
    const result = await runAiReview(projects);
    return NextResponse.json(result);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

// Returns count of projects not yet AI-reviewed (have justification but no ai_flags entry)
export async function HEAD() {
  try {
    const projects = await fetchAllProjects();
    const processed = getProcessedRecordIds();
    const pending = projects.filter(
      (p) => p.fields['Override Hours Spent Justification'] && !processed.has(p.id)
    ).length;
    return new NextResponse(null, {
      headers: { 'X-Pending-Count': String(pending) },
    });
  } catch {
    return new NextResponse(null, { status: 500 });
  }
}
