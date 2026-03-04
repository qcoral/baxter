'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  AreaChart, Area,
} from 'recharts';
import type { UserData, UserProject } from '@/app/api/users/route';

// Gaussian KDE scaled to people-density units (y ≈ people per hour)
function kde(values: number[], bandwidth: number, nPoints = 100) {
  if (values.length === 0) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const step = (max - min) / nPoints;
  const out: { x: number; people: number }[] = [];
  for (let i = 0; i <= nPoints; i++) {
    const x = min + i * step;
    let density = 0;
    for (const v of values) {
      const z = (x - v) / bandwidth;
      density += Math.exp(-0.5 * z * z);
    }
    // scale: density/unit-hour × N people = people/hour
    out.push({ x: Math.round(x), people: (density / (bandwidth * Math.sqrt(2 * Math.PI))) });
  }
  return out;
}

function ScaleToggle({ log, onToggle }: { log: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors ${
        log ? 'bg-indigo-50 border-indigo-300 text-indigo-600' : 'border-gray-200 text-gray-400 hover:text-gray-600'
      }`}
    >
      log
    </button>
  );
}

function StatsPanel({ users }: { users: UserData[] }) {
  const [projectsLog, setProjectsLog] = useState(false);
  const [hoursLog, setHoursLog] = useState(false);

  const projectDist = useMemo(() => {
    const counts = new Map<number, number>();
    for (const u of users) counts.set(u.totalProjects, (counts.get(u.totalProjects) ?? 0) + 1);
    const max = Math.max(0, ...counts.keys());
    return Array.from({ length: max }, (_, i) => ({ projects: i + 1, people: counts.get(i + 1) ?? 0 }));
  }, [users]);

  const hoursDist = useMemo(() => {
    const hours = users
      .map(u => u.projects.reduce((s, p) => s + Number(p.overrideHours ?? p.hoursLogged ?? 0), 0))
      .filter(h => h > 0);
    if (hours.length < 2) return [];
    const mean = hours.reduce((a, b) => a + b, 0) / hours.length;
    const std = Math.sqrt(hours.reduce((s, h) => s + (h - mean) ** 2, 0) / hours.length);
    const bw = Math.max(1, 1.06 * std * Math.pow(hours.length, -0.2));
    return kde(hours, bw);
  }, [users]);

  if (users.length === 0) return null;

  const tooltipStyle = { fontSize: 11, borderRadius: 6, border: '1px solid #e5e7eb' };

  return (
    <div className="max-w-4xl mx-auto grid grid-cols-2 gap-3 mb-3">
      <div className="bg-white border border-gray-200 rounded-lg p-3">
        <div className="flex items-center justify-between mb-2">
          <div className="text-xs font-medium text-gray-500">Projects per person</div>
          <ScaleToggle log={projectsLog} onToggle={() => setProjectsLog(v => !v)} />
        </div>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={projectDist} margin={{ top: 4, right: 8, bottom: 0, left: -16 }}>
            <XAxis dataKey="projects" tick={{ fontSize: 10 }} tickLine={false} />
            <YAxis
              tick={{ fontSize: 10 }} tickLine={false} axisLine={false}
              scale={projectsLog ? 'log' : 'auto'}
              domain={projectsLog ? [0.5, 'auto'] : [0, 'auto']}
              allowDataOverflow={projectsLog}
              tickFormatter={(v) => projectsLog && v < 1 ? '' : String(Math.round(v))}
            />
            <Tooltip
              cursor={{ fill: '#f3f4f6' }}
              formatter={(v: number) => [v, 'people']}
              labelFormatter={(l) => `${l} project${l !== 1 ? 's' : ''}`}
              contentStyle={tooltipStyle}
            />
            <Bar dataKey="people" fill="#6366f1" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-3">
        <div className="flex items-center justify-between mb-2">
          <div className="text-xs font-medium text-gray-500">Hours per person (KDE smoothed)</div>
          <ScaleToggle log={hoursLog} onToggle={() => setHoursLog(v => !v)} />
        </div>
        <ResponsiveContainer width="100%" height={240}>
          <AreaChart data={hoursDist} margin={{ top: 4, right: 8, bottom: 0, left: -16 }}>
            <XAxis dataKey="x" tick={{ fontSize: 10 }} tickLine={false} tickFormatter={(v) => `${v}h`} />
            <YAxis
              tick={{ fontSize: 10 }} tickLine={false} axisLine={false}
              scale={hoursLog ? 'log' : 'auto'}
              domain={hoursLog ? ['auto', 'auto'] : [0, 'auto']}
              allowDataOverflow={hoursLog}
              tickFormatter={(v) => v < 0.0001 ? '' : v.toFixed(3)}
            />
            <Tooltip
              cursor={{ stroke: '#6366f1', strokeWidth: 1, strokeDasharray: '3 3' }}
              formatter={(v: number) => [v.toFixed(4), 'density']}
              labelFormatter={(l) => `~${l}h`}
              contentStyle={tooltipStyle}
            />
            <Area type="monotone" dataKey="people" stroke="#6366f1" fill="#eef2ff" strokeWidth={2} dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

type HardwareFilter = 'all' | 'hardware';

const statusColors: Record<string, string> = {
  good: 'bg-green-100 text-green-700',
  minor_issue: 'bg-yellow-100 text-yellow-700',
  major_issue: 'bg-red-100 text-red-700',
};

const statusLabels: Record<string, string> = {
  good: 'Good',
  minor_issue: 'Minor',
  major_issue: 'Major',
};

function ProjectPill({ project }: { project: UserProject }) {
  const hours = project.overrideHours ?? project.hoursLogged;
  const inner = (
    <div className="flex items-center gap-1.5 px-2 py-1 bg-gray-50 border border-gray-200 rounded text-xs">
      <span className="text-gray-700 font-medium truncate max-w-[100px]" title={project.program ?? undefined}>
        {project.program ?? '—'}
      </span>
      {hours != null && <span className="text-gray-400">{hours}h</span>}
      {project.isHardware && (
        <span className="px-1 py-0.5 bg-orange-100 text-orange-600 rounded text-[10px] font-medium">HW</span>
      )}
      {project.reviewStatus && (
        <span className={`px-1 py-0.5 rounded text-[10px] font-medium ${statusColors[project.reviewStatus]}`}>
          {statusLabels[project.reviewStatus]}
        </span>
      )}
      {project.aiFlag === 'flagged' && (
        <span className="px-1 py-0.5 bg-red-100 text-red-600 rounded text-[10px] font-medium">AI⚑</span>
      )}
    </div>
  );
  if (project.playableUrl) {
    return (
      <a href={project.playableUrl} target="_blank" rel="noopener noreferrer" className="hover:opacity-75 transition-opacity">
        {inner}
      </a>
    );
  }
  return inner;
}

function Avatar({ user }: { user: UserData }) {
  const [imgError, setImgError] = useState(false);
  const name = user.slack?.displayName || `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() || user.email;
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');

  if (user.slack?.avatar48 && !imgError) {
    return (
      <img
        src={user.slack.avatar192}
        alt={name}
        onError={() => setImgError(true)}
        className="w-10 h-10 rounded-full flex-shrink-0 object-cover"
      />
    );
  }

  return (
    <div className="w-10 h-10 rounded-full flex-shrink-0 bg-indigo-100 text-indigo-700 flex items-center justify-center text-sm font-semibold">
      {initials || '?'}
    </div>
  );
}

function UserCard({ user }: { user: UserData }) {
  const displayName =
    user.slack?.displayName ||
    [user.firstName, user.lastName].filter(Boolean).join(' ') ||
    user.email;

  const totalHours = user.projects.reduce((sum, p) => {
    return sum + Number(p.overrideHours ?? p.hoursLogged ?? 0);
  }, 0);

  const reviewedCount = user.projects.filter((p) => p.reviewStatus).length;

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 flex gap-3">
      <Avatar user={user} />

      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium text-gray-900 text-sm">{displayName}</span>
              {user.slack && (
                <span className="text-xs text-gray-400">@{user.slack.handle}</span>
              )}
              {user.hasHardware && (
                <span className="px-1.5 py-0.5 bg-orange-100 text-orange-700 rounded text-[10px] font-medium">
                  Hardware
                </span>
              )}
            </div>
            <div className="text-xs text-gray-400 mt-0.5">{user.email}</div>
          </div>

          <div className="flex-shrink-0 text-right text-xs text-gray-500">
            <div>{user.totalProjects} project{user.totalProjects !== 1 ? 's' : ''}</div>
            <div>{Math.round(totalHours)}h total</div>
            {reviewedCount > 0 && (
              <div className="text-gray-400">{reviewedCount} reviewed</div>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5 mt-2">
          {user.projects.map((p) => (
            <ProjectPill key={p.id} project={p} />
          ))}
        </div>
      </div>
    </div>
  );
}

export default function UsersPage() {
  const [users, setUsers] = useState<UserData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [hwFilter, setHwFilter] = useState<HardwareFilter>('all');

  useEffect(() => {
    fetch('/api/users')
      .then((r) => r.json())
      .then((data) => {
        setUsers(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch((e) => {
        setError(String(e));
        setLoading(false);
      });
  }, []);

  const filtered = useMemo(() => {
    let list = users;
    if (hwFilter === 'hardware') list = list.filter((u) => u.hasHardware);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((u) => {
        const name = `${u.firstName ?? ''} ${u.lastName ?? ''} ${u.slack?.displayName ?? ''} ${u.slack?.handle ?? ''}`.toLowerCase();
        return name.includes(q) || u.email.toLowerCase().includes(q);
      });
    }
    return list;
  }, [users, hwFilter, search]);

  const stats = useMemo(() => ({
    total: users.length,
    hardware: users.filter((u) => u.hasHardware).length,
    withSlack: users.filter((u) => u.slack).length,
  }), [users]);

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
        <span className="text-xs text-indigo-600 font-medium px-2 py-1 rounded bg-indigo-50">
          Users
        </span>
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
        <div className="flex-1" />
        {!loading && (
          <div className="text-xs text-gray-400 flex gap-3">
            <span>{stats.total} users</span>
            <span>{stats.hardware} hardware</span>
            <span>{stats.withSlack} on Slack</span>
          </div>
        )}
      </header>

      <div className="flex items-center gap-3 px-4 py-3 bg-white border-b border-gray-100 flex-shrink-0">
        <input
          type="search"
          placeholder="Search by name, email, or Slack handle…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 max-w-md px-3 py-1.5 text-sm border border-gray-200 rounded-md outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-100"
        />
        <div className="flex gap-1">
          {(['all', 'hardware'] as HardwareFilter[]).map((f) => (
            <button
              key={f}
              onClick={() => setHwFilter(f)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors capitalize ${
                hwFilter === f ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {loading && (
          <div className="text-center text-gray-400 text-sm mt-16">
            Loading users and Slack profiles…
          </div>
        )}
        {error && (
          <div className="text-center text-red-500 text-sm mt-16">{error}</div>
        )}
        {!loading && !error && filtered.length === 0 && (
          <div className="text-center text-gray-400 text-sm mt-16">No users found.</div>
        )}
        {!loading && !error && (
          <>
            <StatsPanel users={users} />
            <div className="flex flex-col gap-2 max-w-4xl mx-auto">
              {filtered.map((user) => (
                <UserCard key={user.email} user={user} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
