import sharp from 'sharp';

export interface TreeEntry {
  path: string;
  type: 'blob' | 'tree';
  size?: number;
}

function githubHeaders(): HeadersInit {
  const token = process.env.GITHUB_TOKEN;
  return {
    Accept: 'application/vnd.github+json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function githubFetch(url: string): Promise<Response> {
  const res = await fetch(url, { headers: githubHeaders(), cache: 'no-store' });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`GitHub API ${res.status}: ${body.slice(0, 200)}`);
  }
  return res;
}

export async function parseGitHubUrl(url: string): Promise<{ owner: string; repo: string; branch: string }> {
  // Accepts: https://github.com/owner/repo, /tree/branch, /blob/branch/...
  const match = url.match(/github\.com\/([^/]+)\/([^/?#]+)(?:\/(?:tree|blob)\/([^/?#]+))?/);
  if (!match) throw new Error(`Not a valid GitHub URL: ${url}`);

  const owner = match[1];
  const repo = match[2].replace(/\.git$/, '');
  let branch = match[3] ?? null;

  if (!branch) {
    const data = await (await githubFetch(`https://api.github.com/repos/${owner}/${repo}`)).json();
    branch = data.default_branch ?? 'main';
  }

  return { owner, repo, branch };
}

export async function fetchTree(owner: string, repo: string, branch: string): Promise<TreeEntry[]> {
  const data = await (
    await githubFetch(
      `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`
    )
  ).json();

  if (!Array.isArray(data.tree)) {
    throw new Error('GitHub tree API returned unexpected shape');
  }

  return (data.tree as { path: string; type: string; size?: number }[])
    .filter((e) => e.path && (e.type === 'blob' || e.type === 'tree'))
    .map((e) => ({ path: e.path, type: e.type as 'blob' | 'tree', size: e.size }));
}

export async function fetchFileContent(
  owner: string,
  repo: string,
  branch: string,
  filePath: string
): Promise<string> {
  const data = await (
    await githubFetch(
      `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(filePath)}?ref=${branch}`
    )
  ).json();

  if (typeof data.content !== 'string') {
    throw new Error(`File not found or is a directory: ${filePath}`);
  }

  const decoded = Buffer.from(data.content.replace(/\n/g, ''), 'base64').toString('utf-8');
  return decoded;
}

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp']);
const MEDIA_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
};

export function isImagePath(filePath: string): boolean {
  const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase();
  return IMAGE_EXTENSIONS.has(ext);
}

export async function fetchImageFromUrl(url: string): Promise<{ data: string; mediaType: string }> {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Failed to fetch image URL: ${res.status}`);

  const contentType = res.headers.get('content-type') ?? 'image/png';
  const mediaType = contentType.split(';')[0].trim();

  const buf = Buffer.from(await res.arrayBuffer());

  if (buf.byteLength > 200 * 1024) {
    const resized = await sharp(buf)
      .resize({ width: 800, height: 800, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();
    return { data: resized.toString('base64'), mediaType: 'image/jpeg' };
  }

  return { data: buf.toString('base64'), mediaType };
}

export async function fetchImageBase64(
  owner: string,
  repo: string,
  branch: string,
  filePath: string
): Promise<{ data: string; mediaType: string }> {
  const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase();
  const mediaType = MEDIA_TYPES[ext] ?? 'image/png';

  const data = await (
    await githubFetch(
      `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(filePath)}?ref=${branch}`
    )
  ).json();

  if (typeof data.content !== 'string') {
    throw new Error(`Image not found: ${filePath}`);
  }

  // GitHub returns base64 with newlines — strip them
  let base64 = data.content.replace(/\n/g, '');

  // For files >1MB the Contents API returns content:"" and a download_url instead
  if (base64.length === 0) {
    if (typeof data.download_url !== 'string') {
      throw new Error(`Image too large and no download_url available: ${filePath}`);
    }
    const imgRes = await fetch(data.download_url, { headers: githubHeaders(), cache: 'no-store' });
    if (!imgRes.ok) throw new Error(`Failed to download image: ${imgRes.status}`);
    const buf = await imgRes.arrayBuffer();
    base64 = Buffer.from(buf).toString('base64');
  }

  // Resize images >200KB to keep vision token usage low (800px max = ~4 tiles ≈ 5k tokens)
  const buf = Buffer.from(base64, 'base64');
  if (buf.byteLength > 200 * 1024) {
    const resized = await sharp(buf)
      .resize({ width: 800, height: 800, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();
    return { data: resized.toString('base64'), mediaType: 'image/jpeg' };
  }

  return { data: base64, mediaType };
}
