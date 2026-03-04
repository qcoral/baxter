import { NextRequest, NextResponse } from 'next/server';
import { fetchPrints } from '@/lib/printlegion';
import { getApiCache, setApiCache } from '@/lib/db';

export type Granularity = 'daily' | 'weekly' | 'monthly';

export interface TimeSeriesPoint {
  date: string;
  count: number;
  weight: number;
}

export interface ProgramBreakdown {
  program: string;
  count: number;
  weight: number;
}

export interface PrintLegionData {
  timeSeries: TimeSeriesPoint[];
  programs: ProgramBreakdown[];
  totalPrints: number;
  totalWeight: number;
  uniquePrinters: number;
}

function getWeekStart(dateStr: string): string {
  const d = new Date(dateStr);
  const day = d.getUTCDay(); // 0 = Sunday
  const diff = day === 0 ? 6 : day - 1; // Monday-based
  d.setUTCDate(d.getUTCDate() - diff);
  return d.toISOString().slice(0, 10);
}

function bucketDate(dateStr: string, granularity: Granularity): string {
  if (granularity === 'daily') return dateStr.slice(0, 10);
  if (granularity === 'weekly') return getWeekStart(dateStr);
  return dateStr.slice(0, 7); // monthly: "2025-06"
}

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

export async function GET(req: NextRequest) {
  const granularity = (req.nextUrl.searchParams.get('granularity') ?? 'weekly') as Granularity;
  const cacheKey = `printlegion:${granularity}`;

  const cached = getApiCache(cacheKey);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    return new Response(cached.data, {
      headers: {
        'Content-Type': 'application/json',
        'X-Cache': 'HIT',
        'X-Cache-Age': String(Math.round((Date.now() - cached.cachedAt) / 1000)),
      },
    });
  }

  const prints = await fetchPrints();

  // Time series aggregation
  const timeMap = new Map<string, { count: number; weight: number }>();
  const programMap = new Map<string, { count: number; weight: number }>();
  const printerIds = new Set<string>();

  for (const p of prints) {
    const created = p.fields['Created'];
    if (!created) continue;

    const bucket = bucketDate(created, granularity);
    const weight = Number(p.fields['weight_grams'] ?? 0);
    const program = p.fields['what program is this print for?'] ?? 'Unknown';

    // Time series
    const ts = timeMap.get(bucket) ?? { count: 0, weight: 0 };
    ts.count += 1;
    ts.weight += weight;
    timeMap.set(bucket, ts);

    // Program breakdown
    const pg = programMap.get(program) ?? { count: 0, weight: 0 };
    pg.count += 1;
    pg.weight += weight;
    programMap.set(program, pg);

    // Unique printers (slack_id)
    const slackId = p.fields['slack_id'];
    if (slackId) printerIds.add(slackId);
  }

  // Fill gaps in time series between first and last date
  const sortedBuckets = [...timeMap.keys()].sort();
  const timeSeries: TimeSeriesPoint[] = [];

  if (sortedBuckets.length > 0) {
    const first = new Date(sortedBuckets[0]);
    const last = new Date(sortedBuckets[sortedBuckets.length - 1]);
    const cur = new Date(first);

    while (cur <= last) {
      const key = granularity === 'monthly'
        ? cur.toISOString().slice(0, 7)
        : cur.toISOString().slice(0, 10);
      const entry = timeMap.get(key) ?? { count: 0, weight: 0 };
      timeSeries.push({ date: key, count: entry.count, weight: Math.round(entry.weight) });

      if (granularity === 'daily') cur.setUTCDate(cur.getUTCDate() + 1);
      else if (granularity === 'weekly') cur.setUTCDate(cur.getUTCDate() + 7);
      else cur.setUTCMonth(cur.getUTCMonth() + 1);
    }
  }

  const programs: ProgramBreakdown[] = [...programMap.entries()]
    .map(([program, v]) => ({ program, count: v.count, weight: Math.round(v.weight) }))
    .sort((a, b) => b.count - a.count);

  const totalPrints = prints.length;
  const totalWeight = Math.round(prints.reduce((s, p) => s + Number(p.fields['weight_grams'] ?? 0), 0));

  const result: PrintLegionData = {
    timeSeries,
    programs,
    totalPrints,
    totalWeight,
    uniquePrinters: printerIds.size,
  };

  const json = JSON.stringify(result);
  setApiCache(cacheKey, json);
  return new Response(json, { headers: { 'Content-Type': 'application/json', 'X-Cache': 'MISS' } });
}
