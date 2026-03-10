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
  // Identity
  'First Name'?: string;
  'Last Name'?: string;
  'Email'?: string;
  'Slack ID'?: string;
  'Phone Number'?: string;
  'Birthday'?: string;
  // Address
  'Address (Line 1)'?: string;
  'City'?: string;
  'State / Province'?: string;
  'ZIP / Postal Code'?: string;
  'Country'?: string;
  'Unified Address'?: string;
  // Project
  'Project Name'?: string;
  'Code URL'?: string;
  'Playable URL'?: string;
  'Description'?: string;
  'Screenshot'?: Screenshot[];
  'Review Type'?: string;
  // Hours
  'Hours Self-Reported'?: number;
  'Optional - Override Hours Spent'?: number;
  'Optional - Override Hours Spent Justification'?: string;
  // Grant
  'Grant Amount'?: number;
  'Grant Tier'?: string;
  'Requested Grant Amount'?: number;
  'Cost per hour'?: number;
  'Total Cost'?: number;
  'Tickets Awarded'?: number;
  'Ticket Dollar Value'?: number;
  'Give Grant'?: boolean;
  'Gave Grant'?: boolean;
  'Grant Sender'?: string;
  'Grant Synced to BP'?: boolean;
  'HCB Grant Message'?: string;
  // Soldering iron
  'Give Soldering Iron Grant'?: boolean;
  'Gave Soldering Iron'?: boolean;
  'Soldering Iron Given?'?: boolean;
  'Soldering Iron Giver'?: string;
  'Needs Soldering Iron (from BP Project)'?: (boolean | null)[];
  'iron wait time'?: number;
  'Mailed Kit'?: boolean;
  // Program / YSWS
  'YSWS'?: string[];           // program slugs (e.g. "hackpad") — matches hardware.toml
  'YSWS Summary'?: string[];
  // Automation
  'Automation - First Submitted At'?: string;
  'Automation - Status'?: string;
  'Automation - YSWS Record ID'?: string;
  'Created'?: string;
  // Linked records
  'BP Project'?: string[];
  'BP Project ID'?: number;
  'BP User'?: string[];
  'Users 2'?: string[];
  // Checks
  'checks_01_github_valid'?: boolean;
  'checks_02_playable_valid'?: boolean;
  'checks_03_readme_exists'?: boolean;
  'checks_04_has_image'?: boolean;
  'checks_05_3d_file'?: boolean;
  'checks_06_pcb_file'?: boolean;
  'checks_07_firmware_file'?: boolean;
  'checks_09_is_not_duplicate'?: boolean;
  'checks_10_has_justification'?: boolean;
  'checks_11_has_hours'?: boolean;
  'checks_ran_at'?: string;
  // Compliance
  'Sanctions Check'?: string;
}

export interface AirtableProject {
  id: string;
  createdTime: string;
  fields: ProjectFields;
}

async function fetchFromView(view: string): Promise<AirtableProject[]> {
  const token = process.env.BLUEPRINT_AIRTABLE_ACCESS_TOKEN;
  const baseId = process.env.BLUEPRINT_AIRTABLE_BASE_ID;
  const tableId = process.env.BLUEPRINT_AIRTABLE_TABLE_ID;

  const all: AirtableProject[] = [];
  let offset: string | undefined;

  do {
    const params = new URLSearchParams({
      view,
      'sort[0][field]': 'Automation - First Submitted At',
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

const blueprintView = makeViewFetcher('AIRTABLE_VIEW');
const hardwareView = makeViewFetcher('HARDWARE_AIRTABLE_VIEW');

export const fetchAllProjects = blueprintView.fetch;
export const invalidateProjectsCache = blueprintView.invalidate;

export const fetchHardwareProjects = hardwareView.fetch;
export const invalidateHardwareProjectsCache = hardwareView.invalidate;
