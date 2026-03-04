export interface Screenshot {
  id: string;
  url: string;
  filename: string;
  type: string;
  thumbnails?: {
    small?: { url: string; width: number; height: number };
    large?: { url: string; width: number; height: number };
    full?: { url: string; width: number; height: number };
  };
}

export interface ProjectFields {
  'ID'?: string;
  'First Name'?: string;
  'Last Name'?: string;
  'Email'?: string;
  'Code URL'?: string;
  'Playable URL'?: string;
  'Override Hours Spent'?: number;
  'Override Hours Spent Justification'?: string;
  'Hours Spent'?: number;
  'Country'?: string;
  'Geocoded - Country'?: string;
  'Age When Approved'?: number;
  'Approved At'?: string;
  'YSWS'?: string[];       // multipleRecordLinks — linked program record IDs (matches hardware.toml)
  'YSWS–Name'?: string[]; // rollup of the program name (display only)
  'Description'?: string;
  'Screenshot'?: Screenshot[];
  'Repo - Language'?: string;
  'Repo - Star Count'?: number;
  'Repo - Exists?'?: string;
  'GitHub Username'?: string;
}

export interface AirtableProject {
  id: string;
  createdTime: string;
  fields: ProjectFields;
}

async function fetchFromView(view: string): Promise<AirtableProject[]> {
  const token = process.env.AIRTABLE_ACCESS_TOKEN;
  const baseId = process.env.AIRTABLE_BASE_ID;
  const tableId = process.env.AIRTABLE_TABLE_ID;

  const all: AirtableProject[] = [];
  let offset: string | undefined;

  do {
    const params = new URLSearchParams({
      view,
      'sort[0][field]': 'Approved At',
      'sort[0][direction]': 'asc',
    });
    if (offset) params.set('offset', offset);

    const res = await fetch(
      `https://api.airtable.com/v0/${baseId}/${tableId}?${params}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store', // don't cache individual paginated requests; offset cursors expire in ~1 min
      }
    );

    if (!res.ok) {
      const err = await res.json();
      throw new Error(`Airtable: ${JSON.stringify(err)}`);
    }

    const data = await res.json();
    all.push(...data.records);
    offset = data.offset;
  } while (offset);

  return all;
}

const CACHE_TTL_MS = 5 * 60 * 1000;

// Creates an independent in-memory cache + single-flight fetcher for one Airtable view
function makeViewFetcher(envVar: string) {
  let cache: { projects: AirtableProject[]; fetchedAt: number } | null = null;
  let pending: Promise<AirtableProject[]> | null = null;

  function invalidate() {
    cache = null;
  }

  async function fetch(): Promise<AirtableProject[]> {
    if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return cache.projects;
    if (pending) return pending;
    pending = fetchFromView(process.env[envVar]!)
      .then((projects) => { cache = { projects, fetchedAt: Date.now() }; pending = null; return projects; })
      .catch((err) => { pending = null; throw err; });
    return pending;
  }

  return { fetch, invalidate };
}

const blueprintView = makeViewFetcher('BLUEPRINT_AIRTABLE_VIEW');
const hardwareView = makeViewFetcher('HARDWARE_AIRTABLE_VIEW');

export const fetchAllProjects = blueprintView.fetch;
export const invalidateProjectsCache = blueprintView.invalidate;

export const fetchHardwareProjects = hardwareView.fetch;
export const invalidateHardwareProjectsCache = hardwareView.invalidate;
