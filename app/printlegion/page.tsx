'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  AreaChart, Area, CartesianGrid,
} from 'recharts';
import type { PrintLegionData, Granularity } from '@/app/api/printlegion/route';

function ScaleToggle({ log, onToggle }: { log: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors ${
        log ? 'bg-emerald-50 border-emerald-300 text-emerald-600' : 'border-gray-200 text-gray-400 hover:text-gray-600'
      }`}
    >
      log
    </button>
  );
}

function GranularityToggle({
  value,
  onChange,
}: {
  value: Granularity;
  onChange: (g: Granularity) => void;
}) {
  const options: Granularity[] = ['daily', 'weekly', 'monthly'];
  return (
    <div className="flex gap-1">
      {options.map((g) => (
        <button
          key={g}
          onClick={() => onChange(g)}
          className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors capitalize ${
            value === g
              ? 'bg-emerald-50 border-emerald-300 text-emerald-600 font-medium'
              : 'border-gray-200 text-gray-400 hover:text-gray-600'
          }`}
        >
          {g}
        </button>
      ))}
    </div>
  );
}

function formatDate(date: string, granularity: Granularity): string {
  if (granularity === 'monthly') {
    const [y, m] = date.split('-');
    const month = new Date(Number(y), Number(m) - 1).toLocaleString('en', { month: 'short' });
    return `${month} '${y.slice(2)}`;
  }
  // daily or weekly
  const d = new Date(date + 'T00:00:00Z');
  return d.toLocaleDateString('en', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export default function PrintLegionPage() {
  const [data, setData] = useState<PrintLegionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [granularity, setGranularity] = useState<Granularity>('weekly');
  const [countLog, setCountLog] = useState(false);
  const [weightLog, setWeightLog] = useState(false);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/printlegion?granularity=${granularity}`)
      .then((r) => r.json())
      .then((d) => {
        setData(d);
        setLoading(false);
      })
      .catch((e) => {
        setError(String(e));
        setLoading(false);
      });
  }, [granularity]);

  const tooltipStyle = { fontSize: 11, borderRadius: 6, border: '1px solid #e5e7eb' };

  const tickFormatter = (v: string) => formatDate(v, granularity);

  // Thin out X axis ticks for readability
  const tickInterval = useMemo(() => {
    if (!data) return 0;
    const n = data.timeSeries.length;
    if (n <= 20) return 0;
    if (n <= 60) return Math.floor(n / 10);
    return Math.floor(n / 8);
  }, [data]);

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
        <span className="text-xs text-emerald-600 font-medium px-2 py-1 rounded bg-emerald-50">
          PrintLegion
        </span>
        <Link
          href="/checker"
          className="text-xs text-gray-500 hover:text-blue-600 transition-colors px-2 py-1 rounded hover:bg-blue-50"
        >
          Checker
        </Link>
        <div className="flex-1" />
        {!loading && data && (
          <div className="text-xs text-gray-400 flex gap-3">
            <span>{data.totalPrints.toLocaleString()} prints</span>
            <span>{(data.totalWeight / 1000).toFixed(1)} kg total</span>
            <span>{data.uniquePrinters} printers</span>
          </div>
        )}
      </header>

      <div className="flex-1 overflow-y-auto p-4">
        {loading && (
          <div className="text-center text-gray-400 text-sm mt-16">Loading PrintLegion data…</div>
        )}
        {error && (
          <div className="text-center text-red-500 text-sm mt-16">{error}</div>
        )}
        {!loading && !error && data && (
          <div className="max-w-4xl mx-auto flex flex-col gap-3">

            {/* Granularity toggle */}
            <div className="flex items-center justify-between">
              <div className="text-xs text-gray-500 font-medium">Prints over time</div>
              <GranularityToggle value={granularity} onChange={setGranularity} />
            </div>

            {/* Count over time */}
            <div className="bg-white border border-gray-200 rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs font-medium text-gray-500">Prints per {granularity === 'daily' ? 'day' : granularity === 'weekly' ? 'week' : 'month'}</div>
                <ScaleToggle log={countLog} onToggle={() => setCountLog((v) => !v)} />
              </div>
              <ResponsiveContainer width="100%" height={240}>
                <AreaChart data={data.timeSeries} margin={{ top: 4, right: 8, bottom: 0, left: -16 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 10 }}
                    tickLine={false}
                    interval={tickInterval}
                    tickFormatter={tickFormatter}
                  />
                  <YAxis
                    tick={{ fontSize: 10 }}
                    tickLine={false}
                    axisLine={false}
                    scale={countLog ? 'log' : 'auto'}
                    domain={countLog ? [0.5, 'auto'] : [0, 'auto']}
                    allowDataOverflow={countLog}
                    tickFormatter={(v) => countLog && v < 1 ? '' : String(Math.round(v))}
                  />
                  <Tooltip
                    cursor={{ stroke: '#10b981', strokeWidth: 1, strokeDasharray: '3 3' }}
                    formatter={(v: number) => [v, 'prints']}
                    labelFormatter={(l) => formatDate(l, granularity)}
                    contentStyle={tooltipStyle}
                  />
                  <Area
                    type="monotone"
                    dataKey="count"
                    stroke="#10b981"
                    fill="#d1fae5"
                    strokeWidth={2}
                    dot={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            {/* Weight over time */}
            <div className="bg-white border border-gray-200 rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs font-medium text-gray-500">Weight per {granularity === 'daily' ? 'day' : granularity === 'weekly' ? 'week' : 'month'} (grams)</div>
                <ScaleToggle log={weightLog} onToggle={() => setWeightLog((v) => !v)} />
              </div>
              <ResponsiveContainer width="100%" height={240}>
                <AreaChart data={data.timeSeries} margin={{ top: 4, right: 8, bottom: 0, left: -8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 10 }}
                    tickLine={false}
                    interval={tickInterval}
                    tickFormatter={tickFormatter}
                  />
                  <YAxis
                    tick={{ fontSize: 10 }}
                    tickLine={false}
                    axisLine={false}
                    scale={weightLog ? 'log' : 'auto'}
                    domain={weightLog ? [0.5, 'auto'] : [0, 'auto']}
                    allowDataOverflow={weightLog}
                    tickFormatter={(v) => weightLog && v < 1 ? '' : v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(Math.round(v))}
                  />
                  <Tooltip
                    cursor={{ stroke: '#10b981', strokeWidth: 1, strokeDasharray: '3 3' }}
                    formatter={(v: number) => [`${v.toLocaleString()}g`, 'weight']}
                    labelFormatter={(l) => formatDate(l, granularity)}
                    contentStyle={tooltipStyle}
                  />
                  <Area
                    type="monotone"
                    dataKey="weight"
                    stroke="#10b981"
                    fill="#d1fae5"
                    strokeWidth={2}
                    dot={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            {/* Program breakdown */}
            {data.programs.length > 0 && (
              <div className="bg-white border border-gray-200 rounded-lg p-3">
                <div className="text-xs font-medium text-gray-500 mb-2">Prints by program</div>
                <ResponsiveContainer width="100%" height={Math.max(120, data.programs.length * 28)}>
                  <BarChart
                    data={data.programs}
                    layout="vertical"
                    margin={{ top: 4, right: 40, bottom: 0, left: 8 }}
                  >
                    <XAxis type="number" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                    <YAxis
                      type="category"
                      dataKey="program"
                      tick={{ fontSize: 10 }}
                      tickLine={false}
                      axisLine={false}
                      width={80}
                    />
                    <Tooltip
                      cursor={{ fill: '#f3f4f6' }}
                      formatter={(v: number, name: string) => [v, name === 'count' ? 'prints' : 'grams']}
                      contentStyle={tooltipStyle}
                    />
                    <Bar dataKey="count" fill="#10b981" radius={[0, 3, 3, 0]} label={{ position: 'right', fontSize: 10, fill: '#6b7280' }} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

          </div>
        )}
      </div>
    </div>
  );
}
