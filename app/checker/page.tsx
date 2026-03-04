'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';

type LineType =
  | { type: 'status'; message: string }
  | { type: 'debug'; message: string }
  | { type: 'text'; text: string }
  | { type: 'tool'; name: string; path: string }
  | { type: 'tool_result'; path: string; detail: string }
  | { type: 'error'; message: string };

type Status = 'idle' | 'running' | 'done' | 'error';

export default function CheckerPage() {
  const [url, setUrl] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [lines, setLines] = useState<LineType[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom as output streams in
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [lines]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim() || status === 'running') return;

    const ac = new AbortController();
    abortRef.current = ac;
    setLines([]);
    setStatus('running');

    try {
      const res = await fetch('/api/checker', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
        signal: ac.signal,
      });

      if (!res.ok || !res.body) {
        throw new Error(`Server error: ${res.status}`);
      }

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
              // Merge consecutive text lines into one
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
            // malformed SSE line — skip
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

  function handleCancel() {
    abortRef.current?.abort();
  }

  const running = status === 'running';

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      <header className="flex items-center gap-3 px-4 h-12 bg-white border-b border-gray-200 flex-shrink-0">
        <Link href="/" className="font-bold text-gray-900 hover:text-gray-600 transition-colors">
          Baxter
        </Link>
        <div className="h-4 w-px bg-gray-200" />
        <Link
          href="/flags"
          className="text-xs text-gray-500 hover:text-violet-600 transition-colors px-2 py-1 rounded hover:bg-violet-50"
        >
          ✦ AI Flags
        </Link>
        <Link
          href="/users"
          className="text-xs text-gray-500 hover:text-indigo-600 transition-colors px-2 py-1 rounded hover:bg-indigo-50"
        >
          Users
        </Link>
        <Link
          href="/printlegion"
          className="text-xs text-gray-500 hover:text-emerald-600 transition-colors px-2 py-1 rounded hover:bg-emerald-50"
        >
          PrintLegion
        </Link>
        <span className="text-xs text-blue-600 font-medium px-2 py-1 rounded bg-blue-50">
          Checker
        </span>
      </header>

      <div className="flex flex-col flex-1 min-h-0 p-4 max-w-3xl mx-auto w-full">
        {/* URL input */}
        <form onSubmit={handleSubmit} className="flex gap-2 mb-3">
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://github.com/owner/repo"
            disabled={running}
            className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-md outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100 disabled:opacity-50 disabled:bg-gray-50"
          />
          {running ? (
            <button
              type="button"
              onClick={handleCancel}
              className="px-4 py-2 rounded-md text-sm font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors"
            >
              Cancel
            </button>
          ) : (
            <button
              type="submit"
              disabled={!url.trim()}
              className="px-4 py-2 rounded-md text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 transition-colors"
            >
              Check
            </button>
          )}
        </form>

        {/* Status badge */}
        {status !== 'idle' && (
          <div className="mb-2">
            {running && (
              <span className="inline-flex items-center gap-1.5 text-xs text-blue-600">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
                Analyzing…
              </span>
            )}
            {status === 'done' && (
              <span className="text-xs text-green-600 font-medium">Analysis complete</span>
            )}
            {status === 'error' && (
              <span className="text-xs text-red-500 font-medium">Error</span>
            )}
          </div>
        )}

        {/* Log output */}
        {lines.length > 0 && (
          <div
            ref={logRef}
            className="flex-1 min-h-0 overflow-y-auto bg-white border border-gray-200 rounded-lg p-4 text-sm leading-relaxed"
          >
            {lines.map((line, i) => {
              if (line.type === 'status') {
                return (
                  <div key={i} className="text-blue-500 text-xs font-mono font-medium mt-2 mb-0.5">
                    {line.message}
                  </div>
                );
              }
              if (line.type === 'debug') {
                return (
                  <div key={i} className="text-gray-400 text-[11px] font-mono pl-2 mb-0.5">
                    {line.message}
                  </div>
                );
              }
              if (line.type === 'tool') {
                return (
                  <div key={i} className="text-amber-600 text-xs font-mono mt-1.5 mb-0">
                    ↓ {line.name === 'get_image' ? '🖼 ' : '📄 '}{line.path}
                  </div>
                );
              }
              if (line.type === 'tool_result') {
                return (
                  <div key={i} className="text-gray-400 text-[11px] font-mono pl-3 mb-1">
                    ✓ {line.detail}
                  </div>
                );
              }
              if (line.type === 'error') {
                return (
                  <div key={i} className="text-red-500 text-xs font-mono mt-2">
                    Error: {line.message}
                  </div>
                );
              }
              // text — render as markdown
              return (
                <ReactMarkdown
                  key={i}
                  components={{
                    h1: ({ children }) => <h1 className="text-base font-bold mt-4 mb-1.5 text-gray-900">{children}</h1>,
                    h2: ({ children }) => <h2 className="text-sm font-bold mt-3 mb-1 text-gray-900">{children}</h2>,
                    h3: ({ children }) => <h3 className="text-sm font-semibold mt-2 mb-0.5 text-gray-800">{children}</h3>,
                    p: ({ children }) => <p className="mb-2 text-gray-800 leading-relaxed">{children}</p>,
                    ul: ({ children }) => <ul className="list-disc pl-5 mb-2 space-y-0.5">{children}</ul>,
                    ol: ({ children }) => <ol className="list-decimal pl-5 mb-2 space-y-0.5">{children}</ol>,
                    li: ({ children }) => <li className="text-gray-800">{children}</li>,
                    strong: ({ children }) => <strong className="font-semibold text-gray-900">{children}</strong>,
                    em: ({ children }) => <em className="italic">{children}</em>,
                    code: ({ children }) => <code className="bg-gray-100 px-1 py-0.5 rounded text-xs font-mono text-gray-700">{children}</code>,
                    pre: ({ children }) => <pre className="bg-gray-100 p-3 rounded-md text-xs font-mono overflow-x-auto mb-2 text-gray-700">{children}</pre>,
                    hr: () => <hr className="my-3 border-gray-200" />,
                    blockquote: ({ children }) => <blockquote className="border-l-2 border-gray-300 pl-3 text-gray-500 my-2">{children}</blockquote>,
                  }}
                >
                  {line.text}
                </ReactMarkdown>
              );
            })}
            {running && (
              <span className="inline-block w-1.5 h-4 bg-blue-400 animate-pulse ml-0.5 align-text-bottom" />
            )}
          </div>
        )}

        {status === 'idle' && (
          <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
            Paste a GitHub repository URL above to begin
          </div>
        )}
      </div>
    </div>
  );
}
