import { NextResponse } from 'next/server';
import { fetchAllProjects } from '@/lib/airtable';
import { getAllReviews, upsertReview } from '@/lib/db';

const CHECK_FIELDS = [
  'checks_01_github_valid',
  'checks_02_playable_valid',
  'checks_03_readme_exists',
  'checks_04_has_image',
  'checks_05_3d_file',
  'checks_06_pcb_file',
  'checks_07_firmware_file',
  'checks_09_is_not_duplicate',
  'checks_10_has_justification',
  'checks_11_has_hours',
] as const;

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const overwrite = body.overwrite === true;

    const projects = await fetchAllProjects();
    const existingReviews = new Map(getAllReviews().map((r) => [r.record_id, r]));

    let marked = 0;
    let skipped = 0;
    let noChecks = 0;

    for (const project of projects) {
      const { fields } = project;

      if (!fields['checks_ran_at']) {
        noChecks++;
        continue;
      }

      // Airtable omits false booleans entirely — undefined means the check failed
      const failedChecks = CHECK_FIELDS.filter((f) => fields[f] !== true);
      if (failedChecks.length === 0) continue;

      const existing = existingReviews.get(project.id);
      if (existing && !overwrite) {
        skipped++;
        continue;
      }

      const note = `auto: failed ${failedChecks.length} check(s): ${failedChecks.join(', ')}`;
      upsertReview(project.id, 'minor_issue', note, null);
      marked++;
    }

    return NextResponse.json({ marked, skipped, noChecks });
  } catch (e) {
    console.error('[POST /api/auto-categorize]', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
