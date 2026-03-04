'use client';

import { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';

type LineType =
  | { type: 'status'; message: string }
  | { type: 'debug'; message: string }
  | { type: 'text'; text: string }
  | { type: 'tool'; name: string; path: string }
  | { type: 'tool_result'; path: string; detail: string }
  | { type: 'error'; message: string };

type Status = 'idle' | 'running' | 'done' | 'error';

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

// Split AI output on the --- separator — anything after is user-facing
function extractUserFacing(text: string): { before: string; after: string | null } {
  // Match a line that is exactly "---" (markdown HR)
  const match = text.match(/\n---\n/);
  if (!match || match.index === undefined) return { before: text, after: null };
  return {
    before: text.slice(0, match.index),
    after: text.slice(match.index + 5),
  };
}

export default function CheckerPage() {
  const [url, setUrl] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [lines, setLines] = useState<LineType[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const outputRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
    if (outputRef.current) outputRef.current.scrollTop = outputRef.current.scrollHeight;
  }, [lines]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim() || status === 'running') return;

    const ac = new AbortController();
    abortRef.current = ac;
    setLines([]);
    setStatus('running');

    try {
      const res = await fetch('/api/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
        signal: ac.signal,
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
              setStatus('done');
            } else if (event.type === 'error') {
              setLines((prev) => [...prev, { type: 'error', message: event.message }]);
              setStatus('error');
            } else if (event.type === 'status') {
              setLines((prev) => [...prev, { type: 'status', message: event.message }]);
            } else if (event.type === 'debug') {
              setLines((prev) => [...prev, { type: 'debug', message: event.message }]);
            } else if (event.type === 'tool_result') {
              setLines((prev) => [...prev, { type: 'tool_result', path: event.path, detail: event.detail }]);
            } else if (event.type === 'text') {
              setLines((prev) => {
                const last = prev[prev.length - 1];
                if (last?.type === 'text') {
                  return [...prev.slice(0, -1), { type: 'text', text: last.text + event.text }];
                }
                return [...prev, { type: 'text', text: event.text }];
              });
            } else if (event.type === 'tool_use') {
              setLines((prev) => [...prev, { type: 'tool', name: event.name, path: event.path }]);
            }
          } catch {
            // malformed SSE — skip
          }
        }
      }

      setStatus((s) => (s === 'running' ? 'done' : s));
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setLines((prev) => [...prev, { type: 'error', message: String(err) }]);
        setStatus('error');
      } else {
        setStatus('idle');
      }
    }
  }

  const running = status === 'running';
  const logLines = lines.filter((l) => l.type !== 'text');
  const allText = lines
    .filter((l): l is { type: 'text'; text: string } => l.type === 'text')
    .map((l) => l.text)
    .join('');

  const { after: userFacingText } = extractUserFacing(allText);

  return (
    <div className="flex flex-col h-screen bg-ctp-base text-ctp-text font-mono">
      {/* Header */}
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

        {/* URL input */}
        <div className="flex flex-col gap-2">
          <form onSubmit={handleSubmit} className="flex gap-2">
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://github.com/owner/repo"
              disabled={running}
              className="flex-1 px-3 py-2 text-sm bg-ctp-mantle border border-ctp-surface1 rounded outline-none focus:border-ctp-blue focus:ring-1 focus:ring-ctp-blue/30 placeholder-ctp-overlay0 text-ctp-text disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            />
            {running ? (
              <button
                type="button"
                onClick={() => abortRef.current?.abort()}
                className="px-4 py-2 rounded text-sm bg-ctp-surface1 text-ctp-subtext0 hover:bg-ctp-surface2 transition-colors"
              >
                cancel
              </button>
            ) : (
              <button
                type="submit"
                disabled={!url.trim()}
                className="px-4 py-2 rounded text-sm bg-ctp-blue text-ctp-base font-bold hover:bg-ctp-sapphire disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                check
              </button>
            )}
          </form>

          {status !== 'idle' && (
            <div className="text-xs">
              {running && (
                <span className="inline-flex items-center gap-1.5 text-ctp-blue">
                  <span className="w-1.5 h-1.5 rounded-full bg-ctp-blue animate-pulse" />
                  analyzing…
                </span>
              )}
              {status === 'done' && <span className="text-ctp-green">✓ analysis complete</span>}
              {status === 'error' && <span className="text-ctp-red">✗ error</span>}
            </div>
          )}
        </div>

        {/* Two-panel output */}
        {lines.length > 0 && (
          <div className="flex gap-3 flex-1 min-h-0">
            {/* Left: activity log */}
            <div
              ref={logRef}
              className="w-72 flex-shrink-0 overflow-y-auto bg-ctp-mantle border border-ctp-surface0 rounded p-3 text-xs"
            >
              <div className="text-[10px] text-ctp-overlay0 uppercase tracking-widest mb-2">activity</div>
              {logLines.map((line, i) => {
                if (line.type === 'status') {
                  return (
                    <div key={i} className="text-ctp-blue font-medium mt-2 mb-0.5">
                      {line.message}
                    </div>
                  );
                }
                if (line.type === 'debug') {
                  return (
                    <div key={i} className="text-ctp-overlay0 text-[11px] pl-2 mb-0.5">
                      {line.message}
                    </div>
                  );
                }
                if (line.type === 'tool') {
                  return (
                    <div key={i} className="text-ctp-peach mt-1.5 mb-0">
                      ↓ {line.name === 'get_image' ? '▣ ' : '▤ '}{line.path}
                    </div>
                  );
                }
                if (line.type === 'tool_result') {
                  return (
                    <div key={i} className="text-ctp-overlay0 text-[11px] pl-3 mb-1">
                      ✓ {line.detail}
                    </div>
                  );
                }
                if (line.type === 'error') {
                  return (
                    <div key={i} className="text-ctp-red mt-2">
                      error: {line.message}
                    </div>
                  );
                }
                return null;
              })}
              {running && (
                <span className="inline-block w-1.5 h-3 bg-ctp-blue animate-pulse mt-1" />
              )}
            </div>

            {/* Right: user-facing verdict */}
            <div
              ref={outputRef}
              className="flex-1 overflow-y-auto bg-ctp-mantle border border-ctp-surface0 rounded p-4 text-sm leading-relaxed"
            >
              <div className="text-[10px] text-ctp-overlay0 uppercase tracking-widest mb-3">review</div>

              {userFacingText === null && running && (
                <span className="text-ctp-overlay1 text-xs">
                  <span className="inline-block w-1.5 h-3 bg-ctp-overlay1 animate-pulse mr-1.5 align-text-bottom" />
                  reasoning…
                </span>
              )}

              {userFacingText === null && !running && allText.length > 0 && (
                // No --- found — show full text as fallback
                <ReactMarkdown components={mdComponents}>{allText}</ReactMarkdown>
              )}

              {userFacingText !== null && (
                <ReactMarkdown components={mdComponents}>{userFacingText}</ReactMarkdown>
              )}

              {running && userFacingText !== null && (
                <span className="inline-block w-1.5 h-4 bg-ctp-blue animate-pulse ml-0.5 align-text-bottom" />
              )}
            </div>
          </div>
        )}

        {status === 'idle' && (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 text-ctp-overlay0">
            <span className="text-2xl text-ctp-surface2">◈</span>
            <span className="text-sm">paste a github url above to begin</span>
          </div>
        )}
      </div>
    </div>
  );
}
