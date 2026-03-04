export interface PrintFields {
  'Created'?: string;
  'weight_grams'?: number;
  'what program is this print for?'?: string;
  'slack_id'?: string;
  'stl_count'?: number;
  'printer'?: string[];
}

export interface PrintRecord {
  id: string;
  createdTime: string;
  fields: PrintFields;
}

async function fetchAllPrints(): Promise<PrintRecord[]> {
  const token = process.env.PRINTLEGION_AIRTABLE_ACCESS_TOKEN;
  const baseId = process.env.PRINTLEGION_AIRTABLE_BASE_ID;
  const tableId = process.env.PRINTLEGION_AIRTABLE_TABLE_ID;

  const all: PrintRecord[] = [];
  let offset: string | undefined;

  do {
    const params = new URLSearchParams({
      'sort[0][field]': 'Created',
      'sort[0][direction]': 'asc',
    });
    if (offset) params.set('offset', offset);

    const res = await fetch(
      `https://api.airtable.com/v0/${baseId}/${tableId}?${params}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      }
    );

    if (!res.ok) {
      const err = await res.json();
      throw new Error(`PrintLegion Airtable: ${JSON.stringify(err)}`);
    }

    const data = await res.json();
    all.push(...data.records);
    offset = data.offset;
  } while (offset);

  return all;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: { prints: PrintRecord[]; fetchedAt: number } | null = null;
let pending: Promise<PrintRecord[]> | null = null;

export async function fetchPrints(): Promise<PrintRecord[]> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return cache.prints;
  if (pending) return pending;
  pending = fetchAllPrints()
    .then((prints) => {
      cache = { prints, fetchedAt: Date.now() };
      pending = null;
      return prints;
    })
    .catch((err) => {
      pending = null;
      throw err;
    });
  return pending;
}

export function invalidatePrintsCache(): void {
  cache = null;
}
