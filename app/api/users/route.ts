import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { fetchHardwareProjects } from '@/lib/airtable';
import { getAllReviews, getAllAiFlags, getApiCache, setApiCache } from '@/lib/db';
import { lookupSlackUserByEmail } from '@/lib/slack';

function getHardwareNames(): Set<string> {
  const toml = fs.readFileSync(path.join(process.cwd(), 'defs/hardware.toml'), 'utf-8');
  const match = toml.match(/hardware\s*=\s*\[([\s\S]*?)\]/);
  if (!match) return new Set();
  return new Set([...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]));
}

async function chunkMap<T>(
  items: T[],
  size: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map(fn));
  }
}

export interface UserProject {
  id: string;
  playableUrl: string | null;
  program: string | null;
  isHardware: boolean;
  hoursLogged: number | null;
  overrideHours: number | null;
  reviewStatus: 'good' | 'minor_issue' | 'major_issue' | null;
  aiFlag: 'flagged' | 'pass' | null;
  approvedAt: string | null;
}

export interface UserData {
  email: string;
  firstName: string | null;
  lastName: string | null;
  slack: {
    id: string;
    handle: string;
    displayName: string;
    avatar48: string;
    avatar192: string;
  } | null;
  projects: UserProject[];
  totalProjects: number;
  hasHardware: boolean;
}

const CACHE_KEY = 'users';
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

export async function GET() {
  const cached = getApiCache(CACHE_KEY);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    return new Response(cached.data, {
      headers: {
        'Content-Type': 'application/json',
        'X-Cache': 'HIT',
        'X-Cache-Age': String(Math.round((Date.now() - cached.cachedAt) / 1000)),
      },
    });
  }

  const [projects, reviews, flags] = await Promise.all([
    fetchHardwareProjects(),
    getAllReviews(),
    getAllAiFlags(),
  ]);

  const hardwareNames = getHardwareNames();
  const reviewMap = new Map(reviews.map((r) => [r.record_id, r]));
  const flagMap = new Map(flags.map((f) => [f.record_id, f]));

  // Group projects by email
  const byEmail = new Map<string, typeof projects>();
  for (const p of projects) {
    const email = p.fields['Email'];
    if (!email) continue;
    if (!byEmail.has(email)) byEmail.set(email, []);
    byEmail.get(email)!.push(p);
  }

  const emails = [...byEmail.keys()];
  const slackMap = new Map<string, Awaited<ReturnType<typeof lookupSlackUserByEmail>>>();

  // Look up Slack profiles in batches of 10 (well within Tier 3 rate limit)
  await chunkMap(emails, 10, async (email) => {
    slackMap.set(email, await lookupSlackUserByEmail(email));
  });

  const users: UserData[] = emails.map((email) => {
    const userProjects = byEmail.get(email)!;
    const slack = slackMap.get(email) ?? null;
    // Use the first project's name fields as the canonical name for this user
    const firstName = userProjects[0]?.fields['First Name'] ?? null;
    const lastName = userProjects[0]?.fields['Last Name'] ?? null;

    const projectDetails: UserProject[] = userProjects.map((p) => {
      const review = reviewMap.get(p.id) ?? null;
      const flag = flagMap.get(p.id) ?? null;
      const programName = p.fields['YSWS']?.[0] ?? null;
      return {
        id: p.id,
        playableUrl: p.fields['Playable URL'] ?? null,
        program: programName,
        isHardware: programName != null && hardwareNames.has(programName),
        hoursLogged: p.fields['Hours Self-Reported'] ?? null,
        overrideHours: p.fields['Optional - Override Hours Spent'] ?? null,
        reviewStatus: review?.status ?? null,
        aiFlag: flag ? (flag.flagged ? 'flagged' : 'pass') : null,
        approvedAt: p.fields['Automation - First Submitted At'] ?? null,
      };
    });

    return {
      email,
      firstName,
      lastName,
      slack: slack
        ? {
            id: slack.id,
            handle: slack.name,
            displayName: slack.profile.display_name || slack.real_name,
            avatar48: slack.profile.image_48,
            avatar192: slack.profile.image_192,
          }
        : null,
      projects: projectDetails,
      totalProjects: projectDetails.length,
      hasHardware: projectDetails.some((p) => p.isHardware),
    };
  });

  // Sort by most projects first, then alphabetically
  users.sort((a, b) => {
    if (b.totalProjects !== a.totalProjects) return b.totalProjects - a.totalProjects;
    const nameA = `${a.firstName ?? ''} ${a.lastName ?? ''}`.trim();
    const nameB = `${b.firstName ?? ''} ${b.lastName ?? ''}`.trim();
    return nameA.localeCompare(nameB);
  });

  const json = JSON.stringify(users);
  setApiCache(CACHE_KEY, json);
  return new Response(json, { headers: { 'Content-Type': 'application/json', 'X-Cache': 'MISS' } });
}
