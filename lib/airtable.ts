import { unstable_cache } from 'next/cache';

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
  'YSWS–Name'?: string[];
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

async function fetchAllProjectsUncached(): Promise<AirtableProject[]> {
  const token = process.env.AIRTABLE_ACCESS_TOKEN;
  const baseId = process.env.AIRTABLE_BASE_ID;
  const tableId = process.env.AIRTABLE_TABLE_ID;
  const view = process.env.AIRTABLE_VIEW;

  const all: AirtableProject[] = [];
  let offset: string | undefined;

  do {
    const params = new URLSearchParams({
      view: view!,
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

// Cache the entire multi-page fetch as one unit so stale offset cursors are never re-used
export const fetchAllProjects = unstable_cache(
  fetchAllProjectsUncached,
  ['airtable-projects'],
  { revalidate: 300, tags: ['airtable-projects'] }
);
