import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';
import { upsertAiFlag, getProcessedRecordIds } from './db';
import type { AirtableProject } from './airtable';

const MODEL = 'claude-haiku-4-5-20251001';
// 50 records per chunk: each flagged reason is ~60 words (~80 tokens), worst-case 50 flagged = 4k
// output tokens. Keep well under the 8192 output limit.
const CHUNK_SIZE = 50;

function loadPrompts(): { system: string; program: string } {
  const promptsDir = path.join(process.cwd(), 'defs', 'prompts');
  const system = fs.readFileSync(path.join(promptsDir, 'master.md'), 'utf-8');
  const program = fs.readFileSync(
    path.join(promptsDir, 'blueprint', 'hour-justification.md'),
    'utf-8'
  );
  return { system, program };
}

interface ReviewRecord {
  record_id: string;
  hours: number | null;
  justification: string;
}

interface FlagResult {
  record_id: string;
  decision: 'flagged' | 'pass';
  reason: string;
}

async function reviewChunk(
  client: Anthropic,
  system: string,
  programPrompt: string,
  records: ReviewRecord[]
): Promise<FlagResult[]> {
  const userMessage = `${programPrompt}

Here are the projects to review:

${JSON.stringify(records, null, 2)}

Return your response as valid JSON with no additional text, in exactly this format:
{
  "results": [
    {"record_id": "recXXX", "decision": "flagged", "reason": "2-3 sentence explanation"},
    {"record_id": "recYYY", "decision": "pass", "reason": "2-3 sentence explanation"}
  ]
}

Include ALL records in the results array. Use "flagged" or "pass" for decision.`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 8192,
    system,
    messages: [{ role: 'user', content: userMessage }],
  });

  if (response.stop_reason === 'max_tokens') {
    throw new Error(
      `AI response was cut off (max_tokens reached) for chunk of ${records.length} records. ` +
        `Try reducing CHUNK_SIZE further.`
    );
  }

  const text = response.content
    .filter((b) => b.type === 'text')
    .map((b) => (b as { type: 'text'; text: string }).text)
    .join('');

  // Extract the JSON object, handling markdown code fences
  const jsonMatch = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/) ??
                    text.match(/(\{[\s\S]*\})/);
  if (!jsonMatch) throw new Error(`AI returned non-JSON response: ${text.slice(0, 300)}`);

  // Fix common LLM JSON mistakes: trailing commas before ] or }
  const cleaned = jsonMatch[1].replace(/,(\s*[}\]])/g, '$1');

  const parsed = JSON.parse(cleaned) as { results: FlagResult[] };
  return parsed.results ?? [];
}

export async function runAiReview(
  projects: AirtableProject[]
): Promise<{ processed: number; flagged: number; skipped: number }> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not set');
  }

  const { system, program } = loadPrompts();
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const processedIds = getProcessedRecordIds();

  // Only process projects that have a justification and haven't been reviewed yet
  const toReview: ReviewRecord[] = projects
    .filter((p) => p.fields['Override Hours Spent Justification'] && !processedIds.has(p.id))
    .map((p) => ({
      record_id: p.id,
      hours: p.fields['Override Hours Spent'] ?? null,
      justification: p.fields['Override Hours Spent Justification']!,
    }));

  const skipped = projects.filter((p) => processedIds.has(p.id)).length;

  if (toReview.length === 0) {
    return { processed: 0, flagged: 0, skipped };
  }

  // Process in chunks to avoid context window limits
  const chunks: ReviewRecord[][] = [];
  for (let i = 0; i < toReview.length; i += CHUNK_SIZE) {
    chunks.push(toReview.slice(i, i + CHUNK_SIZE));
  }

  let totalFlagged = 0;

  for (const chunk of chunks) {
    const results = await reviewChunk(client, system, program, chunk);
    const resultMap = new Map(results.map((r) => [r.record_id, r]));

    for (const record of chunk) {
      const result = resultMap.get(record.record_id);
      const isFlagged = result?.decision === 'flagged';
      upsertAiFlag(record.record_id, isFlagged, result?.reason ?? '', MODEL);
      if (isFlagged) totalFlagged++;
    }
  }

  return { processed: toReview.length, flagged: totalFlagged, skipped };
}
