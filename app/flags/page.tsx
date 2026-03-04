'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import type { AiFlag } from '@/lib/db';

type Tab = 'flagged' | 'pass';

interface EnrichedFlag extends AiFlag {
  justification: string | null;
  first_name: string | null;
  last_name: string | null;
  hours: number | null;
  program: string | null;
}

export default function FlagsPage() {
  const [flags, setFlags] = useState<EnrichedFlag[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('flagged');
  const [running, setRunning] = useState<'new' | 'flagged' | 'pass' | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [runResult, setRunResult] = useState<{
    processed: number;
    flagged: number;
    skipped: number;
  } | null>(null);
  const [runError, setRunError] = useState<string | null>(null);

  const loadFlags = async () => {
    const data = await fetch('/api/ai-flags').then((r) => r.json());
    setFlags(Array.isArray(data) ? data : []);
  };

  const loadPending = async () => {
    const res = await fetch('/api/ai-flags', { method: 'HEAD' });
    setPendingCount(Number(res.headers.get('X-Pending-Count') ?? 0));
  };

  useEffect(() => {
    Promise.all([loadFlags(), loadPending()]).then(() => setLoading(false));
  }, []);

  const flaggedItems = flags.filter((f) => f.flagged === 1);
  const passItems = flags.filter((f) => f.flagged === 0);

  const handleRun = async (mode: 'new' | 'flagged' | 'pass') => {
    if (running) return;
    setRunning(mode);
    setRunResult(null);
    setRunError(null);
    try {
      const body = mode === 'new' ? {} : { refresh: mode };
      const res = await fetch('/api/ai-flags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Unknown error');
      setRunResult(data);
      await Promise.all([loadFlags(), loadPending()]);
    } catch (e) {
      setRunError(String(e));
    } finally {
      setRunning(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const activeItems = tab === 'flagged' ? flaggedItems : passItems;

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-gray-50">
      {/* Header */}
      <header className="flex items-center gap-3 px-4 h-12 bg-white border-b border-gray-200 flex-shrink-0">
        <Link href="/" className="font-bold text-gray-900 hover:text-blue-600 transition-colors">
          Baxter
        </Link>
        <div className="h-4 w-px bg-gray-200" />
        <span className="text-xs text-violet-600 font-medium px-2 py-1 rounded bg-violet-50">✦ AI Flags</span>
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
        <Link
          href="/checker"
          className="text-xs text-gray-500 hover:text-blue-600 transition-colors px-2 py-1 rounded hover:bg-blue-50"
        >
          Checker
        </Link>

        {/* Tabs */}
        <div className="flex gap-1 ml-2">
          <button
            onClick={() => setTab('flagged')}
            className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
              tab === 'flagged' ? 'bg-red-100 text-red-700' : 'text-gray-500 hover:bg-gray-100'
            }`}
          >
            Flagged <span className="opacity-70">({flaggedItems.length})</span>
          </button>
          <button
            onClick={() => setTab('pass')}
            className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
              tab === 'pass' ? 'bg-green-100 text-green-700' : 'text-gray-500 hover:bg-gray-100'
            }`}
          >
            Pass <span className="opacity-70">({passItems.length})</span>
          </button>
        </div>

        <div className="ml-auto flex items-center gap-2">
          {tab === 'flagged' && flaggedItems.length > 0 && (
            <button
              onClick={() => handleRun('flagged')}
              disabled={!!running}
              className="px-2.5 py-1 text-xs text-red-600 border border-red-200 rounded-lg hover:bg-red-50 disabled:opacity-50 transition-colors"
            >
              {running === 'flagged' ? <Spinner /> : '↻ Re-run flagged'}
            </button>
          )}
          {tab === 'pass' && passItems.length > 0 && (
            <button
              onClick={() => handleRun('pass')}
              disabled={!!running}
              className="px-2.5 py-1 text-xs text-green-700 border border-green-200 rounded-lg hover:bg-green-50 disabled:opacity-50 transition-colors"
            >
              {running === 'pass' ? <Spinner /> : '↻ Re-run passing'}
            </button>
          )}
          {pendingCount > 0 && (
            <button
              onClick={() => handleRun('new')}
              disabled={!!running}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-600 text-white text-xs font-medium rounded-lg hover:bg-violet-700 disabled:opacity-50 transition-colors"
            >
              {running === 'new' ? <Spinner white /> : <>✦ Run AI Review ({pendingCount})</>}
            </button>
          )}
        </div>
      </header>

      {runResult && (
        <div className="flex-shrink-0 px-4 py-2 bg-green-50 border-b border-green-200 text-sm text-green-800">
          ✓ Reviewed {runResult.processed} projects — {runResult.flagged} flagged,{' '}
          {runResult.processed - runResult.flagged} passed.
          {runResult.skipped > 0 && ` ${runResult.skipped} skipped.`}
        </div>
      )}
      {runError && (
        <div className="flex-shrink-0 px-4 py-2 bg-red-50 border-b border-red-200 text-sm text-red-800">
          Error: {runError}
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {activeItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-center">
            <p className="text-gray-400 text-sm">
              {flags.length === 0
                ? 'No AI reviews yet.'
                : tab === 'flagged'
                ? 'No flagged projects.'
                : 'No passing projects.'}
            </p>
            {flags.length === 0 && pendingCount > 0 && (
              <p className="text-gray-400 text-xs">
                {pendingCount} project{pendingCount !== 1 ? 's' : ''} ready to review.
              </p>
            )}
          </div>
        ) : (
          <div className="max-w-5xl mx-auto px-6 py-6 space-y-3">
            {activeItems.map((item) => (
              <ReviewCard key={item.record_id} item={item} tab={tab} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Spinner({ white }: { white?: boolean }) {
  return (
    <span
      className={`w-3 h-3 border-2 rounded-full animate-spin inline-block ${
        white ? 'border-white border-t-transparent' : 'border-current border-t-transparent'
      }`}
    />
  );
}

function ReviewCard({ item, tab }: { item: EnrichedFlag; tab: Tab }) {
  const isFlagged = tab === 'flagged';
  const name = [item.first_name, item.last_name].filter(Boolean).join(' ') || item.record_id;

  return (
    <div
      className={`bg-white rounded-lg p-4 space-y-2 border ${
        isFlagged ? 'border-red-200' : 'border-green-200'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <Link
            href={`/?select=${item.record_id}`}
            className="font-semibold text-gray-900 hover:text-blue-600 transition-colors"
          >
            {name}
          </Link>
          <div className="flex items-center gap-2 mt-0.5">
            {item.program && (
              <span className="text-xs bg-violet-100 text-violet-700 px-1.5 py-0.5 rounded font-medium">
                {item.program}
              </span>
            )}
            {item.hours != null && (
              <span className="text-xs text-gray-500">{item.hours}h override</span>
            )}
          </div>
        </div>
        <span className="text-[10px] text-gray-400 flex-shrink-0 mt-0.5">
          {new Date(item.flagged_at).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
          })}
        </span>
      </div>

      {item.reason && (
        <div className={`p-3 rounded-md ${isFlagged ? 'bg-red-50' : 'bg-green-50'}`}>
          <p
            className={`text-xs font-semibold uppercase tracking-wide mb-1 ${
              isFlagged ? 'text-red-600' : 'text-green-600'
            }`}
          >
            AI {isFlagged ? 'Reason' : 'Justification'}
          </p>
          <p className={`text-sm leading-relaxed ${isFlagged ? 'text-red-900' : 'text-green-900'}`}>
            {item.reason}
          </p>
        </div>
      )}

      {item.justification ? (
        <div className="p-3 bg-gray-50 rounded-md">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1">
            Reviewer Justification
          </p>
          <p className="text-sm text-gray-700 leading-relaxed">{item.justification}</p>
        </div>
      ) : (
        <p className="text-xs text-gray-300 italic">Justification not available for this record</p>
      )}
    </div>
  );
}
