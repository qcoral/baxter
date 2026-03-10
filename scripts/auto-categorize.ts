/**
 * One-time auto-categorization: marks any project that fails at least one
 * automated check as 'minor_issue' in the local reviews DB.
 *
 * Usage:
 *   npm run auto-categorize
 *
 * Flags:
 *   --overwrite   Also update projects that already have a review
 *   --dry-run     Print what would change without writing anything
 */

import path from 'path';
import fs from 'fs';

// Load .env before importing modules that read process.env
const envPath = path.join(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (match && !(match[1] in process.env)) {
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, '').trim();
    }
  }
}

import { fetchAllProjects } from '../lib/airtable';
import { getAllReviews, upsertReview } from '../lib/db';

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

const overwrite = process.argv.includes('--overwrite');
const dryRun = process.argv.includes('--dry-run');

(async () => {
  console.log('Fetching projects from Airtable...');
  const projects = await fetchAllProjects();
  console.log(`  ${projects.length} projects fetched`);

  const existingReviews = new Map(getAllReviews().map((r) => [r.record_id, r]));

  let marked = 0;
  let skipped = 0;
  let noChecks = 0;

  for (const project of projects) {
    const { fields } = project;

    // Skip projects where checks haven't been run yet
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

    const name = [fields['First Name'], fields['Last Name']].filter(Boolean).join(' ') || project.id;
    const note = `auto: failed ${failedChecks.length} check(s): ${failedChecks.join(', ')}`;

    if (dryRun) {
      console.log(`[dry-run] Would mark ${name} (${project.id}) as minor_issue — ${note}`);
    } else {
      upsertReview(project.id, 'minor_issue', note, null);
      console.log(`Marked ${name} (${project.id}) — ${note}`);
    }
    marked++;
  }

  console.log('');
  console.log(`Done.`);
  console.log(`  Marked:         ${marked}`);
  console.log(`  Skipped (existing review, no --overwrite): ${skipped}`);
  console.log(`  Skipped (checks not yet run): ${noChecks}`);
  if (dryRun) console.log('  (dry-run — nothing was written)');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
