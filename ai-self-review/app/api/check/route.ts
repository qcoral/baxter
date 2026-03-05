import fs from 'fs';
import path from 'path';
import Anthropic from '@anthropic-ai/sdk';
import {
  parseGitHubUrl,
  fetchTree,
  fetchFileContent,
  fetchImageBase64,
  fetchImageFromUrl,
  isImagePath,
} from '@/lib/github';

const MODEL = 'claude-haiku-4-5-20251001';
const MAX_TOOL_ROUNDS = 10;

// Pricing for claude-haiku-4-5 (per Anthropic pricing page)
const COST_PER_M_INPUT  = 0.80;  // USD per million input tokens
const COST_PER_M_OUTPUT = 4.00;  // USD per million output tokens

function calcCost(inputTok: number, outputTok: number): string {
  const usd = (inputTok * COST_PER_M_INPUT + outputTok * COST_PER_M_OUTPUT) / 1_000_000;
  return `$${usd.toFixed(4)}`;
}
const MAX_FILE_BYTES = 100 * 1024;
const MAX_CONTENT_CHARS = 3000;

const CONTENT_NOT_NEEDED_EXT = new Set([
  '.c', '.cpp', '.cc', '.cxx', '.h', '.hpp',
  '.py', '.js', '.ts', '.rs', '.go', '.java',
  '.kicad_pro', '.kicad_pcb', '.kicad_sch', '.kicad_mod',
  '.step', '.stp', '.f3d', '.fcstd', '.3mf', '.stl',
  '.gbr', '.drl', '.gbl', '.gtl', '.gbs', '.gts', '.gbo', '.gto',
  '.zip', '.tar', '.gz',
  '.bin', '.hex', '.elf', '.uf2',
]);

type SseEvent =
  | { type: 'status'; message: string }
  | { type: 'debug'; message: string }
  | { type: 'text'; text: string }
  | { type: 'tool_use'; name: string; path: string }
  | { type: 'tool_result'; path: string; detail: string }
  | { type: 'done' }
  | { type: 'error'; message: string };

function sseEncode(event: SseEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

function kb(bytes: number) { return `${Math.round(bytes / 1024)}KB`; }

function formatTree(entries: Awaited<ReturnType<typeof fetchTree>>): string {
  return entries
    .map((e) => {
      if (e.type === 'tree') return `${e.path}/`;
      const sizeStr = e.size != null ? ` (${Math.round(e.size / 1024)}KB)` : '';
      return `${e.path}${sizeStr}`;
    })
    .join('\n');
}

export async function POST(req: Request) {
  const { url } = await req.json().catch(() => ({ url: '' }));
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      function send(event: SseEvent) {
        controller.enqueue(encoder.encode(sseEncode(event)));
      }

      try {
        if (!url) throw new Error('No URL provided');
        if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set');

        send({ type: 'status', message: 'Parsing GitHub URL…' });
        const { owner, repo, branch } = await parseGitHubUrl(url);
        send({ type: 'debug', message: `→ ${owner}/${repo} @ ${branch}` });

        send({ type: 'status', message: 'Fetching repository tree + README…' });
        const [tree, readme] = await Promise.all([
          fetchTree(owner, repo, branch),
          fetchFileContent(owner, repo, branch, 'README.md').catch(() => '(No README.md found)'),
        ]);

        const blobs = tree.filter((e) => e.type === 'blob');
        const images = blobs.filter((e) => isImagePath(e.path));
        const readmeFound = !readme.startsWith('(No README');
        send({ type: 'debug', message: `→ ${blobs.length} files, ${tree.filter(e => e.type === 'tree').length} dirs` });
        send({ type: 'debug', message: `→ ${images.length} image(s): ${images.slice(0, 5).map(e => e.path.split('/').pop()).join(', ')}${images.length > 5 ? ` +${images.length - 5} more` : ''}` });
        send({ type: 'debug', message: `→ README: ${readmeFound ? `${readme.length} chars` : 'not found'}` });

        const systemPromptPath = path.join(process.cwd(), 'defs', 'prompts', 'hardware-reviewer.md');
        const systemPrompt = fs.readFileSync(systemPromptPath, 'utf-8');
        send({ type: 'debug', message: `→ Prompt: ${systemPrompt.length} chars` });

        const tools: Anthropic.Tool[] = [
          {
            name: 'get_file',
            description: 'Fetch the text contents of a file from the GitHub repository. Use for BOM CSVs, markdown files, and config files. Do NOT use for source code (.c, .cpp, .py, .js, .kicad_pro, .kicad_sch, etc.), binaries, or hardware files — presence in the tree is sufficient.',
            input_schema: {
              type: 'object' as const,
              properties: {
                path: { type: 'string', description: 'Repo-relative path (e.g. "BOM.csv")' },
              },
              required: ['path'],
            },
          },
          {
            name: 'get_image',
            description: 'Fetch and view an image. Use for 3D model screenshots, PCB renders, wiring diagrams. Pass a repo-relative path or a full https:// URL for externally hosted images.',
            input_schema: {
              type: 'object' as const,
              properties: {
                path: { type: 'string', description: 'Repo-relative path or full https:// URL' },
              },
              required: ['path'],
            },
          },
        ];

        // Filter the tree to avoid bloating context with deep source file listings
        const displayTree = tree.filter((e) => {
          if (e.type === 'tree') return true;
          const ext = e.path.slice(e.path.lastIndexOf('.')).toLowerCase();
          if (!CONTENT_NOT_NEEDED_EXT.has(ext)) return true;
          // Show source/binary files at depth ≤1 (e.g. firmware/main.c) but not deeper
          return e.path.split('/').length <= 2;
        });
        const omittedCount = blobs.length - displayTree.filter(e => e.type === 'blob').length;
        const treeText = formatTree(displayTree) +
          (omittedCount > 0 ? `\n(+ ${omittedCount} source/binary files omitted — directories above indicate presence)` : '');
        send({ type: 'debug', message: `→ Tree: ${displayTree.length} entries shown, ${omittedCount} blobs omitted` });

        const initialMessage = `Repository: ${owner}/${repo} (branch: ${branch})

## File Tree
\`\`\`
${treeText}
\`\`\`

## README.md
\`\`\`
${readme}
\`\`\`

Please review this repository against the submission criteria.`;

        send({ type: 'debug', message: `→ Initial message: ~${Math.round(initialMessage.length / 4)} tokens est.` });

        const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
        const messages: Anthropic.MessageParam[] = [{ role: 'user', content: initialMessage }];

        let totalCostUsd = 0;

        for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
          send({ type: 'status', message: `[Round ${round + 1}/${MAX_TOOL_ROUNDS}] Calling ${MODEL}…` });

          let response: Awaited<ReturnType<typeof client.messages.create>>;
          for (let attempt = 0; ; attempt++) {
            try {
              response = await client.messages.create({
                model: MODEL,
                max_tokens: 4096,
                system: systemPrompt,
                tools,
                messages,
              });
              break;
            } catch (err) {
              const isOverloaded = err instanceof Anthropic.APIError && err.status === 529;
              if (isOverloaded && attempt < 3) {
                const delaySec = attempt + 2;
                send({ type: 'debug', message: `→ Overloaded (529), retrying in ${delaySec}s… (attempt ${attempt + 1}/3)` });
                await new Promise(r => setTimeout(r, delaySec * 1000));
                continue;
              }
              throw err;
            }
          }

          const inTok = response.usage.input_tokens;
          const outTok = response.usage.output_tokens;
          const roundCost = (inTok * COST_PER_M_INPUT + outTok * COST_PER_M_OUTPUT) / 1_000_000;
          totalCostUsd += roundCost;
          send({ type: 'debug', message: `→ stop_reason: ${response.stop_reason} | in: ${inTok} tok | out: ${outTok} tok | ${calcCost(inTok, outTok)} (total: $${totalCostUsd.toFixed(4)})` });

          const assistantContent: Anthropic.ContentBlock[] = [];
          const toolUseBlocks = response.content.filter(b => b.type === 'tool_use');
          if (toolUseBlocks.length > 0) {
            send({ type: 'debug', message: `→ ${toolUseBlocks.length} tool call(s) requested` });
          }

          for (const block of response.content) {
            if (block.type === 'text') {
              send({ type: 'text', text: block.text });
              assistantContent.push(block);
            } else if (block.type === 'tool_use') {
              assistantContent.push(block);
            }
          }

          messages.push({ role: 'assistant', content: assistantContent });

          if (response.stop_reason === 'end_turn') break;
          if (response.stop_reason !== 'tool_use') break;

          const toolResults: Anthropic.ToolResultBlockParam[] = [];

          for (const block of response.content) {
            if (block.type !== 'tool_use') continue;

            const input = block.input as { path: string };
            const filePath = input.path;
            send({ type: 'tool_use', name: block.name, path: filePath });

            let resultContent: Anthropic.ToolResultBlockParam['content'];

            try {
              if (block.name === 'get_image') {
                const isUrl = filePath.startsWith('http://') || filePath.startsWith('https://');
                if (!isUrl && !isImagePath(filePath)) {
                  resultContent = `Error: ${filePath} is not an image file`;
                  send({ type: 'tool_result', path: filePath, detail: 'error: not an image path' });
                } else {
                  const { data, mediaType } = isUrl
                    ? await fetchImageFromUrl(filePath)
                    : await fetchImageBase64(owner, repo, branch, filePath);
                  const bytes = Math.round(data.length * 0.75);
                  send({ type: 'tool_result', path: filePath, detail: `${kb(bytes)}, ${mediaType}${isUrl ? ' (external URL)' : ''}` });
                  resultContent = [
                    { type: 'image' as const, source: { type: 'base64' as const, media_type: mediaType as 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp', data } },
                  ];
                }
              } else {
                const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase();
                const treeEntry = tree.find((e) => e.path === filePath);
                if (CONTENT_NOT_NEEDED_EXT.has(ext)) {
                  resultContent = `File exists in the repository tree. Reading content of ${ext} files is not needed — presence alone is sufficient.`;
                  send({ type: 'tool_result', path: filePath, detail: `skipped — source/binary type (${ext})` });
                } else if (treeEntry && treeEntry.size && treeEntry.size > MAX_FILE_BYTES) {
                  resultContent = `File too large (${kb(treeEntry.size)}). File exists — note its presence.`;
                  send({ type: 'tool_result', path: filePath, detail: `skipped — too large (${kb(treeEntry.size)})` });
                } else {
                  const raw = await fetchFileContent(owner, repo, branch, filePath);
                  const truncated = raw.length > MAX_CONTENT_CHARS;
                  resultContent = truncated
                    ? raw.slice(0, MAX_CONTENT_CHARS) + `\n\n[... truncated at ${MAX_CONTENT_CHARS} chars — file has ${raw.length} total chars]`
                    : raw;
                  send({ type: 'tool_result', path: filePath, detail: truncated ? `${raw.length} chars → truncated to ${MAX_CONTENT_CHARS}` : `${raw.length} chars` });
                }
              }
            } catch (err) {
              resultContent = `Error fetching ${filePath}: ${String(err)}`;
              send({ type: 'tool_result', path: filePath, detail: `error: ${String(err)}` });
            }

            toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: resultContent });
          }

          messages.push({ role: 'user', content: toolResults });
        }

        send({ type: 'done' });
      } catch (err) {
        send({ type: 'error', message: String(err) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
