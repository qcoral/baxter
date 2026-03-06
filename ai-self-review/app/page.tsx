'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';

type LineType =
  | { type: 'status'; message: string }
  | { type: 'debug'; message: string }
  | { type: 'text'; text: string }
  | { type: 'tool'; name: string; path: string }
  | { type: 'tool_result'; path: string; detail: string }
  | { type: 'error'; message: string };

type Mode = 'single' | 'batch';

type BatchItem = {
  id: string;
  url: string;
  repoName: string;
  status: 'queued' | 'running' | 'done' | 'error';
  lines: LineType[];
};

const mdComponents: React.ComponentProps<typeof ReactMarkdown>['components'] = {
  h1: ({ children }) => <h1 className="text-base font-bold mt-4 mb-1.5 text-ctp-mauve">{children}</h1>,
  h2: ({ children }) => <h2 className="text-sm font-bold mt-3 mb-1 text-ctp-lavender">{children}</h2>,
  h3: ({ children }) => <h3 className="text-sm font-semibold mt-2 mb-0.5 text-ctp-subtext1">{children}</h3>,
  p: ({ children }) => <p className="mb-2 text-ctp-text leading-relaxed">{children}</p>,
  ul: ({ children }) => <ul className="list-disc pl-5 mb-2 space-y-0.5">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal pl-5 mb-2 space-y-0.5">{children}</ol>,
  li: ({ children }) => <li className="text-ctp-text">{children}</li>,
  strong: ({ children }) => <strong className="font-bold text-ctp-subtext1">{children}</strong>,
  em: ({ children }) => <em className="italic text-ctp-subtext0">{children}</em>,
  code: ({ children }) => <code className="bg-ctp-surface0 px-1 py-0.5 rounded text-xs text-ctp-green">{children}</code>,
  pre: ({ children }) => <pre className="bg-ctp-surface0 p-3 rounded text-xs overflow-x-auto mb-2 text-ctp-green">{children}</pre>,
  hr: () => <hr className="my-3 border-ctp-surface1" />,
  blockquote: ({ children }) => <blockquote className="border-l-2 border-ctp-mauve pl-3 text-ctp-subtext0 my-2">{children}</blockquote>,
};

function extractUserFacing(text: string): string | null {
  const match = text.match(/\n---\n/);
  if (!match || match.index === undefined) return null;
  return text.slice(match.index + 5);
}

function repoName(url: string): string {
  const m = url.match(/github\.com\/([^/]+\/[^/?#\s]+)/);
  return m ? m[1] : url;
}

function parseUrls(input: string): string[] {
  return input
    .split(/[\n,]+/)
    .map(s => s.trim())
    .filter(s => /github\.com\/[^/]+\/[^/\s]/.test(s));
}

// Shared SSE reader — resolves when the stream ends
async function streamCheck(
  url: string,
  signal: AbortSignal,
  onLine: (line: LineType) => void,
  onDone: (status: 'done' | 'error') => void,
) {
  try {
    const res = await fetch('/api/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
      signal,
    });

    if (!res.ok || !res.body) throw new Error(`Server error: ${res.status}`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const parts = buffer.split('\n\n');
      buffer = parts.pop() ?? '';

      for (const part of parts) {
        const line = part.trim();
        if (!line.startsWith('data: ')) continue;
        try {
          const event = JSON.parse(line.slice(6));
          if (event.type === 'done') {
            onDone('done');
          } else if (event.type === 'error') {
            onLine({ type: 'error', message: event.message });
            onDone('error');
          } else if (event.type === 'status') {
            onLine({ type: 'status', message: event.message });
          } else if (event.type === 'debug') {
            onLine({ type: 'debug', message: event.message });
          } else if (event.type === 'tool_result') {
            onLine({ type: 'tool_result', path: event.path, detail: event.detail });
          } else if (event.type === 'text') {
            onLine({ type: 'text', text: event.text });
          } else if (event.type === 'tool_use') {
            onLine({ type: 'tool', name: event.name, path: event.path });
          }
        } catch { /* malformed SSE — skip */ }
      }
    }
  } catch (err) {
    if ((err as Error).name !== 'AbortError') {
      onLine({ type: 'error', message: String(err) });
      onDone('error');
    }
  }
}

// Merge consecutive text chunks (same logic both modes need)
function appendLine(prev: LineType[], line: LineType): LineType[] {
  if (line.type === 'text') {
    const last = prev[prev.length - 1];
    if (last?.type === 'text') {
      return [...prev.slice(0, -1), { type: 'text', text: last.text + line.text }];
    }
  }
  return [...prev, line];
}

// Activity log renderer (shared between single + batch)
function ActivityLog({ lines, running }: { lines: LineType[]; running: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [lines]);

  const logLines = lines.filter(l => l.type !== 'text');

  return (
    <div ref={ref} className="w-72 flex-shrink-0 overflow-y-auto bg-ctp-mantle border border-ctp-surface0 rounded p-3 text-xs">
      <div className="text-[10px] text-ctp-overlay0 uppercase tracking-widest mb-2">activity</div>
      {logLines.map((line, i) => {
        if (line.type === 'status') return <div key={i} className="text-ctp-blue font-medium mt-2 mb-0.5">{line.message}</div>;
        if (line.type === 'debug') return <div key={i} className="text-ctp-overlay0 text-[11px] pl-2 mb-0.5">{line.message}</div>;
        if (line.type === 'tool') return <div key={i} className="text-ctp-peach mt-1.5 mb-0">↓ {line.name === 'get_image' ? '▣ ' : '▤ '}{line.path}</div>;
        if (line.type === 'tool_result') return <div key={i} className="text-ctp-overlay0 text-[11px] pl-3 mb-1">✓ {line.detail}</div>;
        if (line.type === 'error') return <div key={i} className="text-ctp-red mt-2">error: {line.message}</div>;
        return null;
      })}
      {running && <span className="inline-block w-1.5 h-3 bg-ctp-blue animate-pulse mt-1" />}
    </div>
  );
}

// Review panel renderer (shared)
function ReviewPanel({ lines, running }: { lines: LineType[]; running: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [lines]);

  const allText = lines.filter((l): l is { type: 'text'; text: string } => l.type === 'text').map(l => l.text).join('');
  const userFacing = extractUserFacing(allText);

  return (
    <div ref={ref} className="flex-1 overflow-y-auto bg-ctp-mantle border border-ctp-surface0 rounded p-4 text-sm leading-relaxed">
      <div className="text-[10px] text-ctp-overlay0 uppercase tracking-widest mb-3">review</div>
      {userFacing === null && running && (
        <span className="text-ctp-overlay1 text-xs">
          <span className="inline-block w-1.5 h-3 bg-ctp-overlay1 animate-pulse mr-1.5 align-text-bottom" />
          reasoning…
        </span>
      )}
      {userFacing === null && !running && allText.length > 0 && (
        <ReactMarkdown components={mdComponents}>{allText}</ReactMarkdown>
      )}
      {userFacing !== null && (
        <ReactMarkdown components={mdComponents}>{userFacing}</ReactMarkdown>
      )}
      {running && userFacing !== null && (
        <span className="inline-block w-1.5 h-4 bg-ctp-blue animate-pulse ml-0.5 align-text-bottom" />
      )}
    </div>
  );
}

export default function CheckerPage() {
  const [mode, setMode] = useState<Mode>('single');

  // Single mode
  const [url, setUrl] = useState('');
  const [singleStatus, setSingleStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [singleLines, setSingleLines] = useState<LineType[]>([]);

  // Batch mode
  const [batchInput, setBatchInput] = useState('');
  const [batchItems, setBatchItems] = useState<BatchItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [batchRunning, setBatchRunning] = useState(false);

  const abortRef = useRef<AbortController | null>(null);

  function updateItem(id: string, updater: (item: BatchItem) => BatchItem) {
    setBatchItems(prev => prev.map(item => item.id === id ? updater(item) : item));
  }

  // ── Single mode ────────────────────────────────────────────────────────────
  async function handleSingleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim() || singleStatus === 'running') return;

    const ac = new AbortController();
    abortRef.current = ac;
    setSingleLines([]);
    setSingleStatus('running');

    await streamCheck(
      url.trim(),
      ac.signal,
      (line) => setSingleLines(prev => appendLine(prev, line)),
      (s) => setSingleStatus(s),
    );

    setSingleStatus(s => s === 'running' ? 'done' : s);
  }

  // ── Batch mode ─────────────────────────────────────────────────────────────
  const runBatch = useCallback(async (items: BatchItem[], signal: AbortSignal) => {
    setBatchRunning(true);
    for (const item of items) {
      if (signal.aborted) break;
      setSelectedId(item.id);
      updateItem(item.id, i => ({ ...i, status: 'running' }));

      let finalStatus: 'done' | 'error' = 'done';
      await streamCheck(
        item.url,
        signal,
        (line) => setBatchItems(prev => prev.map(bi =>
          bi.id === item.id ? { ...bi, lines: appendLine(bi.lines, line) } : bi
        )),
        (s) => { finalStatus = s; },
      );

      updateItem(item.id, i => ({ ...i, status: finalStatus }));
    }
    setBatchRunning(false);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function handleBatchStart() {
    if (batchRunning) return;
    const urls = parseUrls(batchInput);
    if (urls.length === 0) return;

    const items: BatchItem[] = urls.map((u, idx) => ({
      id: `${idx}-${u}`,
      url: u,
      repoName: repoName(u),
      status: 'queued',
      lines: [],
    }));

    setBatchItems(items);
    setSelectedId(items[0].id);

    const ac = new AbortController();
    abortRef.current = ac;
    runBatch(items, ac.signal);
  }

  function handleCancel() {
    abortRef.current?.abort();
    if (mode === 'single') setSingleStatus('idle');
    else setBatchRunning(false);
  }

  const selectedItem = batchItems.find(i => i.id === selectedId) ?? null;
  const displayLines = mode === 'single' ? singleLines : (selectedItem?.lines ?? []);
  const displayRunning = mode === 'single'
    ? singleStatus === 'running'
    : batchRunning && selectedItem?.status === 'running';

  const hasOutput = displayLines.length > 0;

  return (
    <div className="flex flex-col h-screen bg-ctp-base text-ctp-text font-mono">
      <header className="flex items-center justify-between px-5 h-11 bg-ctp-mantle border-b border-ctp-surface0 flex-shrink-0">
        <span className="text-ctp-mauve font-bold tracking-tight">ai-self-review</span>
        <span className="text-[11px] text-ctp-overlay0">hardware submission checker</span>
      </header>

      <div className="flex flex-col flex-1 min-h-0 p-4 gap-3 w-full max-w-7xl mx-auto">
        {/* About blurb */}
        <p className="text-xs text-ctp-subtext0 leading-relaxed max-w-2xl">
          This checker is aimed to help catch simple mistakes like missing files, but it is{' '}
          <em>not</em> an end-all for project review. The goal of adding all of these files is{' '}
          <em>not</em> to pass an imaginary bar we set at Blueprint. It is to make sure your
          project is shipped &amp; usable by other people, and that you will have something you
          are proud to look back on later down the line.
        </p>

        {/* Mode tabs */}
        <div className="flex gap-1 text-xs">
          {(['single', 'batch'] as Mode[]).map(m => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`px-3 py-1 rounded transition-colors ${
                mode === m
                  ? 'bg-ctp-surface1 text-ctp-text'
                  : 'text-ctp-overlay1 hover:text-ctp-subtext0'
              }`}
            >
              {m === 'single' ? 'Single' : 'Repositories'}
            </button>
          ))}
        </div>

        {/* Input area */}
        {mode === 'single' ? (
          <div className="flex flex-col gap-2">
            <form onSubmit={handleSingleSubmit} className="flex gap-2">
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://github.com/owner/repo"
                disabled={singleStatus === 'running'}
                className="flex-1 px-3 py-2 text-sm bg-ctp-mantle border border-ctp-surface1 rounded outline-none focus:border-ctp-blue focus:ring-1 focus:ring-ctp-blue/30 placeholder-ctp-overlay0 text-ctp-text disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              />
              {singleStatus === 'running' ? (
                <button type="button" onClick={handleCancel} className="px-4 py-2 rounded text-sm bg-ctp-surface1 text-ctp-subtext0 hover:bg-ctp-surface2 transition-colors">
                  cancel
                </button>
              ) : (
                <button type="submit" disabled={!url.trim()} className="px-4 py-2 rounded text-sm bg-ctp-blue text-ctp-base font-bold hover:bg-ctp-sapphire disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                  check
                </button>
              )}
            </form>
            <div className="text-xs h-4">
              {singleStatus === 'running' && <span className="inline-flex items-center gap-1.5 text-ctp-blue"><span className="w-1.5 h-1.5 rounded-full bg-ctp-blue animate-pulse" />analyzing…</span>}
              {singleStatus === 'done' && <span className="text-ctp-green">✓ analysis complete</span>}
              {singleStatus === 'error' && <span className="text-ctp-red">✗ error</span>}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="flex gap-2 items-start">
              <textarea
                value={batchInput}
                onChange={(e) => setBatchInput(e.target.value)}
                placeholder={"Paste GitHub URLs — one per line or CSV:\nhttps://github.com/owner/repo1\nhttps://github.com/owner/repo2"}
                disabled={batchRunning}
                rows={4}
                className="flex-1 px-3 py-2 text-sm bg-ctp-mantle border border-ctp-surface1 rounded outline-none focus:border-ctp-blue focus:ring-1 focus:ring-ctp-blue/30 placeholder-ctp-overlay0 text-ctp-text disabled:opacity-50 disabled:cursor-not-allowed resize-none transition-colors"
              />
              <div className="flex flex-col gap-2">
                {batchRunning ? (
                  <button onClick={handleCancel} className="px-4 py-2 rounded text-sm bg-ctp-surface1 text-ctp-subtext0 hover:bg-ctp-surface2 transition-colors whitespace-nowrap">
                    cancel
                  </button>
                ) : (
                  <button
                    onClick={handleBatchStart}
                    disabled={parseUrls(batchInput).length === 0}
                    className="px-4 py-2 rounded text-sm bg-ctp-blue text-ctp-base font-bold hover:bg-ctp-sapphire disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
                  >
                    run all
                  </button>
                )}
                {batchInput && (
                  <span className="text-[11px] text-ctp-overlay0 text-center">
                    {parseUrls(batchInput).length} url{parseUrls(batchInput).length !== 1 ? 's' : ''}
                  </span>
                )}
              </div>
            </div>
            {batchRunning && (
              <div className="text-xs text-ctp-blue inline-flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-ctp-blue animate-pulse" />
                {batchItems.filter(i => i.status === 'done' || i.status === 'error').length}/{batchItems.length} complete
              </div>
            )}
          </div>
        )}

        {/* Output panels */}
        {hasOutput && (
          <div className="flex gap-3 flex-1 min-h-0">
            {/* Batch: repo list sidebar */}
            {mode === 'batch' && batchItems.length > 0 && (
              <div className="w-44 flex-shrink-0 overflow-y-auto bg-ctp-mantle border border-ctp-surface0 rounded p-2 text-xs">
                <div className="text-[10px] text-ctp-overlay0 uppercase tracking-widest mb-2 px-1">repositories</div>
                {batchItems.map(item => {
                  const isSelected = item.id === selectedId;
                  const dot =
                    item.status === 'running' ? 'bg-ctp-blue animate-pulse' :
                    item.status === 'done'    ? 'bg-ctp-green' :
                    item.status === 'error'   ? 'bg-ctp-red' :
                                               'bg-ctp-surface2';
                  return (
                    <button
                      key={item.id}
                      onClick={() => setSelectedId(item.id)}
                      className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-left transition-colors ${
                        isSelected ? 'bg-ctp-surface0 text-ctp-text' : 'text-ctp-subtext0 hover:bg-ctp-surface0/50'
                      }`}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dot}`} />
                      <span className="truncate text-[11px]">{item.repoName}</span>
                    </button>
                  );
                })}
              </div>
            )}

            <ActivityLog lines={displayLines} running={displayRunning} />
            <ReviewPanel lines={displayLines} running={displayRunning} />
          </div>
        )}

        {!hasOutput && singleStatus === 'idle' && !batchRunning && (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 text-ctp-overlay0">
            <span className="text-2xl text-ctp-surface2">◈</span>
            <span className="text-sm">
              {mode === 'single' ? 'paste a github url above to begin' : 'paste urls above and click run all'}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
