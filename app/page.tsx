'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import Link from 'next/link';
import { io } from 'socket.io-client';
import type { AirtableProject } from '@/lib/airtable';
import type { Review, Reviewer } from '@/lib/db';
import type { ReviewerInfo, PresenceEntry, AppSocket, ReviewChangePayload } from '@/lib/socket';

type EnrichedProject = AirtableProject & { review: Review | null };
type Filter = 'unreviewed' | 'all' | 'good' | 'minor_issue' | 'major_issue';
const filterLabels: Record<Filter, string> = {
  unreviewed: 'Unreviewed',
  all: 'All',
  good: 'Good',
  minor_issue: 'Minor Issue',
  major_issue: 'Major Issue',
};

const REVIEWER_KEY = 'baxter:reviewer';

const AVATAR_COLORS = [
  'bg-blue-500', 'bg-violet-500', 'bg-pink-500', 'bg-rose-500',
  'bg-orange-500', 'bg-teal-500', 'bg-cyan-500', 'bg-emerald-500',
];

function reviewerColor(name: string): string {
  let h = 5381;
  for (let i = 0; i < name.length; i++) h = ((h << 5) + h) ^ name.charCodeAt(i);
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

function reviewerInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase())
    .slice(0, 2)
    .join('');
}

// ─── Reviewer Modal ────────────────────────────────────────────────────────────

function ReviewerModal({ onComplete }: { onComplete: (r: ReviewerInfo) => void }) {
  const [reviewers, setReviewers] = useState<Reviewer[]>([]);
  const [selected, setSelected] = useState('');
  const [newName, setNewName] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch('/api/reviewers')
      .then((r) => r.json())
      .then((data: Reviewer[]) => {
        setReviewers(data);
        if (data.length > 0) setSelected(data[0].name);
        else setSelected('__new__');
      })
      .catch(() => setSelected('__new__'));
  }, []);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const name = selected === '__new__' ? newName.trim() : selected;
    if (!name) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/reviewers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const { reviewer } = await res.json();
      const info: ReviewerInfo = { id: reviewer.id, name: reviewer.name };
      localStorage.setItem(REVIEWER_KEY, JSON.stringify(info));
      onComplete(info);
    } catch {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <form
        onSubmit={handleSubmit}
        className="bg-white rounded-xl shadow-xl p-6 w-80 flex flex-col gap-4"
      >
        <div>
          <h2 className="font-bold text-gray-900 text-lg">Who are you?</h2>
          <p className="text-sm text-gray-500 mt-0.5">Select your name to get started.</p>
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-xs font-semibold uppercase tracking-wide text-gray-400">
            Reviewer
          </label>
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {reviewers.map((r) => (
              <option key={r.id} value={r.name}>
                {r.name}
              </option>
            ))}
            <option value="__new__">Add new…</option>
          </select>

          {selected === '__new__' && (
            <input
              autoFocus
              type="text"
              placeholder="Your name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          )}
        </div>

        <button
          type="submit"
          disabled={submitting || (selected === '__new__' && !newName.trim())}
          className="bg-gray-900 text-white rounded-lg py-2 text-sm font-medium hover:bg-gray-800 disabled:opacity-50 transition-colors"
        >
          {submitting ? 'Joining…' : 'Start reviewing'}
        </button>
      </form>
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function Page() {
  const [projects, setProjects] = useState<EnrichedProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('unreviewed');
  const [saving, setSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [autoCategorizing, setAutoCategorizing] = useState(false);

  // Multi-reviewer state
  const [currentReviewer, setCurrentReviewer] = useState<ReviewerInfo | null>(null);
  const [showReviewerModal, setShowReviewerModal] = useState(false);
  const [reviewerModalReady, setReviewerModalReady] = useState(false);
  const socketRef = useRef<AppSocket | null>(null);
  const [presence, setPresence] = useState<PresenceEntry[]>([]);
  const [reviewersMap, setReviewersMap] = useState<Map<string, Reviewer>>(new Map());

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetch('/api/revalidate', { method: 'POST' });
    const data = await fetch('/api/projects').then((r) => r.json());
    setProjects(data);
    setRefreshing(false);
  };

  const handleAutoCategorize = async () => {
    if (!confirm('Mark all projects with failing checks as "minor issue"?')) return;
    setAutoCategorizing(true);
    try {
      const res = await fetch('/api/auto-categorize', { method: 'POST' });
      const { marked, skipped } = await res.json();
      alert(`Done — ${marked} marked as minor issue, ${skipped} skipped (already reviewed)`);
      // Reload projects to reflect changes
      const data = await fetch('/api/projects').then((r) => r.json());
      setProjects(data);
    } catch (e) {
      alert(`Auto-categorize failed: ${e}`);
    } finally {
      setAutoCategorizing(false);
    }
  };

  // Load projects
  useEffect(() => {
    fetch('/api/projects')
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setProjects(data);
        const firstUnreviewed = data.find((p: EnrichedProject) => !p.review);
        setSelectedId(firstUnreviewed?.id ?? data[0]?.id ?? null);
        setLoading(false);
      })
      .catch((e: Error) => {
        setError(e.message);
        setLoading(false);
      });
  }, []);

  // Read reviewer identity from localStorage
  useEffect(() => {
    const raw = localStorage.getItem(REVIEWER_KEY);
    if (raw) {
      try {
        setCurrentReviewer(JSON.parse(raw));
      } catch {
        setShowReviewerModal(true);
      }
    } else {
      setShowReviewerModal(true);
    }
    setReviewerModalReady(true);
  }, []);

  // Fetch reviewers for the map (used for "by X" tags in sidebar)
  useEffect(() => {
    fetch('/api/reviewers')
      .then((r) => r.json())
      .then((data: Reviewer[]) => {
        setReviewersMap(new Map(data.map((r) => [r.id, r])));
      })
      .catch(() => {});
  }, []);

  // Socket connection lifecycle
  useEffect(() => {
    if (!currentReviewer) return;

    const socket: AppSocket = io({ path: '/socket.io' });
    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('join', currentReviewer);
    });

    socket.on('presence_update', (entries) => {
      setPresence(entries);
    });

    socket.on('review_change', (payload: ReviewChangePayload) => {
      if (payload.action === 'delete') {
        setProjects((prev) =>
          prev.map((p) => (p.id === payload.recordId ? { ...p, review: null } : p))
        );
      } else {
        const newReview: Review = {
          record_id: payload.recordId,
          status: payload.status!,
          notes: payload.notes ?? '',
          reviewed_at: payload.reviewed_at ?? new Date().toISOString(),
          reviewer_id: payload.reviewer.id,
        };
        setProjects((prev) =>
          prev.map((p) => (p.id === payload.recordId ? { ...p, review: newReview } : p))
        );
        // Keep reviewers map up to date for new reviewers
        setReviewersMap((prev) => {
          const m = new Map(prev);
          if (!m.has(payload.reviewer.id)) {
            m.set(payload.reviewer.id, {
              id: payload.reviewer.id,
              name: payload.reviewer.name,
              created_at: new Date().toISOString(),
            });
          }
          return m;
        });
      }
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [currentReviewer]);

  const selectedProject = useMemo(
    () => projects.find((p) => p.id === selectedId) ?? null,
    [projects, selectedId]
  );

  useEffect(() => {
    if (textareaRef.current) textareaRef.current.value = selectedProject?.review?.notes ?? '';
    // Broadcast project selection to other reviewers
    socketRef.current?.emit('select_project', selectedId);
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pre-warm the repo URL when a project is selected so pressing R opens it instantly.
  useEffect(() => {
    const raw = selectedProject?.fields['Code URL'];
    if (!raw) return;
    const url = raw.startsWith('http') ? raw : `https://${raw}`;
    let origin: string;
    try { origin = new URL(url).origin; } catch { return; }

    const added: HTMLElement[] = [];
    const add = (el: HTMLElement) => { document.head.appendChild(el); added.push(el); };

    const dns = Object.assign(document.createElement('link'), { rel: 'dns-prefetch', href: origin });
    const pre = Object.assign(document.createElement('link'), { rel: 'preconnect', href: origin });
    dns.setAttribute('data-baxter-prefetch', '');
    pre.setAttribute('data-baxter-prefetch', '');
    add(dns); add(pre);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((HTMLScriptElement as any).supports?.('speculationrules')) {
      const s = document.createElement('script');
      s.type = 'speculationrules';
      s.setAttribute('data-baxter-prefetch', '');
      s.textContent = JSON.stringify({ prerender: [{ urls: [url] }] });
      add(s);
    }

    return () => added.forEach((el) => el.remove());
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  const visibleProjects = useMemo(() =>
    projects.filter((p) => p.fields['Automation - Status'] !== 'TO DELETE IN UNIFIED'),
  [projects]);

  const filteredProjects = useMemo(() => visibleProjects.filter((p) => {
    switch (filter) {
      case 'all': return true;
      case 'unreviewed': return !p.review;
      case 'good': return p.review?.status === 'good';
      case 'minor_issue': return p.review?.status === 'minor_issue';
      case 'major_issue': return p.review?.status === 'major_issue';
    }
  }), [visibleProjects, filter]);

  const counts = useMemo(() => ({
    all: visibleProjects.length,
    unreviewed: visibleProjects.filter((p) => !p.review).length,
    good: visibleProjects.filter((p) => p.review?.status === 'good').length,
    minor_issue: visibleProjects.filter((p) => p.review?.status === 'minor_issue').length,
    major_issue: visibleProjects.filter((p) => p.review?.status === 'major_issue').length,
  }), [visibleProjects]);

  const handleReview = useCallback(
    async (status: 'good' | 'minor_issue' | 'major_issue') => {
      if (!selectedProject || saving) return;
      setSaving(true);
      const isToggleOff = selectedProject.review?.status === status;
      try {
        const res = await fetch('/api/reviews', {
          method: isToggleOff ? 'DELETE' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(
            isToggleOff
              ? { recordId: selectedProject.id }
              : {
                  recordId: selectedProject.id,
                  status,
                  notes: textareaRef.current?.value ?? '',
                  reviewerId: currentReviewer?.id ?? null,
                }
          ),
        });
        if (!res.ok) throw new Error('Failed to save');

        if (isToggleOff) {
          setProjects((prev) =>
            prev.map((p) => (p.id === selectedProject.id ? { ...p, review: null } : p))
          );
          if (textareaRef.current) textareaRef.current.value = '';
          if (currentReviewer) {
            socketRef.current?.emit('review_change', {
              action: 'delete',
              recordId: selectedProject.id,
              reviewer: currentReviewer,
            });
          }
        } else {
          const newReview: Review = {
            record_id: selectedProject.id,
            status,
            notes: textareaRef.current?.value ?? '',
            reviewed_at: new Date().toISOString(),
            reviewer_id: currentReviewer?.id ?? null,
          };

          // Find next unreviewed project after current
          const currentIdx = projects.findIndex((p) => p.id === selectedProject.id);
          let nextId: string | null = null;
          for (let i = currentIdx + 1; i < projects.length; i++) {
            if (!projects[i].review) { nextId = projects[i].id; break; }
          }
          if (!nextId) {
            for (let i = 0; i < currentIdx; i++) {
              if (!projects[i].review) { nextId = projects[i].id; break; }
            }
          }

          setProjects((prev) =>
            prev.map((p) => (p.id === selectedProject.id ? { ...p, review: newReview } : p))
          );
          if (nextId) setSelectedId(nextId);

          if (currentReviewer) {
            socketRef.current?.emit('review_change', {
              action: 'upsert',
              recordId: selectedProject.id,
              reviewer: currentReviewer,
              status,
              notes: newReview.notes,
              reviewed_at: newReview.reviewed_at,
            });
          }
        }
      } catch (e) {
        alert(String(e));
      } finally {
        setSaving(false);
      }
    },
    [selectedProject, saving, projects, currentReviewer]
  );

  // Keyboard shortcuts: g = good, m = minor issue, i = major issue, r = open repo, c = focus notes, s = skip
  const handleReviewRef = useRef(handleReview);
  handleReviewRef.current = handleReview;
  const selectedProjectRef = useRef(selectedProject);
  selectedProjectRef.current = selectedProject;
  const filteredProjectsRef = useRef(filteredProjects);
  filteredProjectsRef.current = filteredProjects;
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'TEXTAREA') return;
      if (e.key === 'g') handleReviewRef.current('good');
      if (e.key === 'm') handleReviewRef.current('minor_issue');
      if (e.key === 'i') handleReviewRef.current('major_issue');
      if (e.key === 'r') {
        const url = selectedProjectRef.current?.fields['Code URL'];
        if (url) window.open(url.startsWith('http') ? url : `https://${url}`, '_blank');
      }
      if (e.key === 'c') {
        e.preventDefault();
        textareaRef.current?.focus();
      }
      if (e.key === 's') {
        const list = filteredProjectsRef.current;
        const idx = list.findIndex((p) => p.id === selectedProjectRef.current?.id);
        const next = list[idx + 1];
        if (next) setSelectedId(next.id);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <div className="text-center">
          <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-gray-500">Loading projects from Airtable…</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <div className="bg-red-50 border border-red-200 rounded-lg p-6 max-w-lg">
          <h2 className="font-semibold text-red-800 mb-2">Error loading projects</h2>
          <p className="text-sm text-red-700 font-mono break-all">{error}</p>
        </div>
      </div>
    );
  }

  if (!selectedProject) {
    return (
      <>
        {showReviewerModal && reviewerModalReady && (
          <ReviewerModal onComplete={(r) => { setCurrentReviewer(r); setShowReviewerModal(false); }} />
        )}
        <div className="flex items-center justify-center h-screen bg-gray-50">
          <p className="text-gray-500">
            {counts.all === 0 ? 'No projects found.' : '🎉 All projects reviewed!'}
          </p>
        </div>
      </>
    );
  }

  const f = selectedProject.fields;
  const reviewStatus = selectedProject.review?.status;

  return (
    <>
      {showReviewerModal && reviewerModalReady && (
        <ReviewerModal onComplete={(r) => { setCurrentReviewer(r); setShowReviewerModal(false); }} />
      )}
      {reviewerModalReady && (
        <div className="flex flex-col h-screen overflow-hidden bg-gray-50">
          {/* Header */}
          <header className="flex items-center gap-3 px-4 h-12 bg-white border-b border-gray-200 flex-shrink-0">
            <span className="font-bold text-gray-900">Baxter</span>
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
        <Link
          href="/checker"
          className="text-xs text-gray-500 hover:text-blue-600 transition-colors px-2 py-1 rounded hover:bg-blue-50"
        >
          Checker
        </Link>
            <div className="h-4 w-px bg-gray-200" />
            <nav className="flex gap-1">
              {(['unreviewed', 'all', 'good', 'minor_issue', 'major_issue'] as Filter[]).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setFilter(tab)}
                  className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                    filter === tab ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  {filterLabels[tab]}{' '}
                  <span className="opacity-60">({counts[tab]})</span>
                </button>
              ))}
            </nav>
            <button
              onClick={handleAutoCategorize}
              disabled={autoCategorizing}
              className="ml-auto text-xs text-amber-600 hover:text-amber-800 disabled:opacity-50 transition-colors px-2 py-1 rounded hover:bg-amber-50"
            >
              {autoCategorizing ? 'Categorizing…' : 'Auto-categorize'}
            </button>
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="text-xs text-gray-500 hover:text-gray-900 disabled:opacity-50 transition-colors px-2 py-1 rounded hover:bg-gray-100"
            >
              {refreshing ? '↻ Refreshing…' : '↻ Refresh'}
            </button>
            <div className="text-xs text-gray-500">
              {counts.good + counts.minor_issue + counts.major_issue}/{counts.all} reviewed ·{' '}
              <span className="text-green-600">{counts.good} good</span> ·{' '}
              <span className="text-amber-500">{counts.minor_issue} minor</span> ·{' '}
              <span className="text-red-500">{counts.major_issue} major</span>
            </div>
            {/* Current reviewer indicator */}
            {currentReviewer && (
              <div className="flex items-center gap-1.5 ml-2">
                <div
                  className={`w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0 ${reviewerColor(currentReviewer.name)}`}
                >
                  {reviewerInitials(currentReviewer.name)}
                </div>
                <span className="text-xs text-gray-500">{currentReviewer.name}</span>
              </div>
            )}
          </header>

          <div className="flex flex-1 overflow-hidden">
            {/* Sidebar */}
            <aside className="w-60 border-r border-gray-200 bg-white overflow-y-auto flex-shrink-0">
              {filteredProjects.length === 0 ? (
                <p className="p-4 text-xs text-gray-400 text-center">No projects</p>
              ) : (
                filteredProjects.map((p) => {
                  const isSelected = p.id === selectedId;
                  const s = p.review?.status;
                  const reviewerName =
                    p.review?.reviewer_id ? reviewersMap.get(p.review.reviewer_id)?.name : null;
                  const projectPresence = presence.filter(
                    (e) => e.projectId === p.id && e.reviewer.id !== currentReviewer?.id
                  );
                  return (
                    <button
                      key={p.id}
                      onClick={() => setSelectedId(p.id)}
                      className={`w-full text-left px-3 py-2.5 border-b border-gray-100 transition-colors ${
                        isSelected ? 'bg-blue-50 border-l-2 border-l-blue-500' : 'hover:bg-gray-50'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                            s === 'good' ? 'bg-green-500' : s === 'major_issue' ? 'bg-red-500' : s === 'minor_issue' ? 'bg-amber-400' : 'bg-gray-300'
                          }`}
                        />
                        <span className="text-sm font-medium text-gray-900 truncate flex-1">
                          {p.fields['First Name']} {p.fields['Last Name']}
                        </span>
                        {/* Presence avatars */}
                        {projectPresence.length > 0 && (
                          <div className="flex -space-x-1 flex-shrink-0">
                            {projectPresence.slice(0, 3).map((e) => (
                              <div
                                key={e.socketId}
                                title={e.reviewer.name}
                                className={`w-4 h-4 rounded-full flex items-center justify-center text-white text-[8px] font-bold ring-1 ring-white ${reviewerColor(e.reviewer.name)}`}
                              >
                                {reviewerInitials(e.reviewer.name)}
                              </div>
                            ))}
                            {projectPresence.length > 3 && (
                              <div className="w-4 h-4 rounded-full bg-gray-400 flex items-center justify-center text-white text-[8px] font-bold ring-1 ring-white">
                                +{projectPresence.length - 3}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5 ml-3.5">
                        <span className="text-xs text-gray-400">{p.fields['YSWS']?.[0]}</span>
                        <span className="text-xs text-gray-400">·</span>
                        <span className="text-xs text-gray-400">
                          {p.fields['Automation - First Submitted At']
                            ? new Date(p.fields['Automation - First Submitted At']).toLocaleDateString('en-US', {
                                month: 'short',
                                day: 'numeric',
                              })
                            : '—'}
                        </span>
                        {reviewerName && (
                          <>
                            <span className="text-xs text-gray-400">·</span>
                            <span className="text-[10px] text-gray-400">by {reviewerName}</span>
                          </>
                        )}
                      </div>
                    </button>
                  );
                })
              )}
            </aside>

            {/* Middle panel — project details, scrollable */}
            <div className="flex-1 flex flex-col overflow-hidden border-r border-gray-200">
              {/* Project header — fixed */}
              <div className="flex-shrink-0 px-5 pt-4 pb-3 bg-white border-b border-gray-100">
                <div className="flex items-start justify-between">
                  <div>
                    <h1 className="text-xl font-bold text-gray-900">
                      {f['First Name']} {f['Last Name']}
                    </h1>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1">
                      {f['YSWS']?.[0] && (
                        <span className="text-xs bg-violet-100 text-violet-700 px-2 py-0.5 rounded font-medium">
                          {f['YSWS'][0]}
                        </span>
                      )}
                      {f['Automation - First Submitted At'] && (
                        <span className="text-sm text-gray-500">
                          {new Date(f['Automation - First Submitted At']).toLocaleDateString('en-US', {
                            year: 'numeric', month: 'long', day: 'numeric',
                          })}
                        </span>
                      )}
                      {f['Country'] && (
                        <span className="text-sm text-gray-500">{f['Country']}</span>
                      )}
                    </div>
                  </div>
                  {reviewStatus && (
                    <span className={`px-3 py-1 rounded-full text-sm font-medium flex-shrink-0 ${
                      reviewStatus === 'good'
                        ? 'bg-green-100 text-green-700'
                        : reviewStatus === 'minor_issue'
                        ? 'bg-amber-100 text-amber-700'
                        : 'bg-red-100 text-red-700'
                    }`}>
                      {reviewStatus === 'good' ? '✓ Good' : reviewStatus === 'minor_issue' ? '⚠ Minor Issue' : '⚠ Major Issue'}
                    </span>
                  )}
                </div>
              </div>

              {/* Scrollable details */}
              <div className="flex-1 overflow-y-auto px-5 py-4 bg-gray-50 space-y-4">
                {/* Key fields */}
                <div className="grid grid-cols-2 gap-3">
                  <FieldCard label="Code URL" value={f['Code URL']} isLink />
                  <FieldCard label="Playable URL" value={f['Playable URL']} isLink />
                  <FieldCard
                    label="Override Hours"
                    value={f['Optional - Override Hours Spent'] != null ? String(f['Optional - Override Hours Spent']) : undefined}
                  />
                </div>

                {/* Automated checks */}
                {f['checks_ran_at'] && (
                  <div className="p-3 bg-white border border-gray-200 rounded-lg">
                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Automated Checks</p>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                      {([
                        ['checks_01_github_valid', 'GitHub valid'],
                        ['checks_02_playable_valid', 'Playable valid'],
                        ['checks_03_readme_exists', 'README exists'],
                        ['checks_04_has_image', 'Has image'],
                        ['checks_05_3d_file', '3D file'],
                        ['checks_06_pcb_file', 'PCB file'],
                        ['checks_07_firmware_file', 'Firmware file'],
                        ['checks_09_is_not_duplicate', 'Not duplicate'],
                        ['checks_10_has_justification', 'Has justification'],
                        ['checks_11_has_hours', 'Has hours'],
                      ] as [keyof typeof f, string][]).map(([key, label]) => {
                        const val = f[key];
                        return (
                          <div key={key} className="flex items-center gap-1.5">
                            <span className={`text-xs font-bold ${val ? 'text-green-500' : 'text-red-500'}`}>
                              {val ? '✓' : '✗'}
                            </span>
                            <span className={`text-xs ${val ? 'text-gray-600' : 'text-red-600 font-medium'}`}>
                              {label}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Override justification */}
                {f['Optional - Override Hours Spent Justification'] && (
                  <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
                    <p className="text-xs font-semibold uppercase tracking-wide text-amber-700 mb-1.5">
                      Override Justification
                    </p>
                    <p className="text-sm text-amber-900 whitespace-pre-wrap leading-relaxed">
                      {f['Optional - Override Hours Spent Justification']}
                    </p>
                  </div>
                )}

                {/* Description */}
                {f['Description'] && (
                  <div className="p-4 bg-white border border-gray-200 rounded-lg">
                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1.5">
                      Description
                    </p>
                    <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
                      {f['Description']}
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Right panel — screenshots + pinned review form */}
            <div className="w-96 flex flex-col overflow-hidden bg-white flex-shrink-0">
              {/* Screenshots — scrollable */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {f['Screenshot'] && f['Screenshot'].length > 0 ? (
                  <>
                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                      Screenshot{f['Screenshot'].length > 1 ? `s (${f['Screenshot'].length})` : ''}
                    </p>
                    {f['Screenshot'].map((s, idx) => (
                      <img
                        key={s.id}
                        src={s.thumbnails?.large?.url ?? s.url}
                        alt={`Screenshot ${idx + 1}`}
                        className="rounded-lg border border-gray-200 w-full object-contain"
                      />
                    ))}
                  </>
                ) : (
                  <p className="text-xs text-gray-300 text-center pt-8">No screenshot</p>
                )}
              </div>

              {/* Review form — pinned to bottom */}
              <div className="flex-shrink-0 p-4 border-t border-gray-200 bg-white">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3">
                  Review{' '}
                  <span className="font-normal normal-case text-gray-400">
                    — <kbd className="bg-gray-100 border border-gray-200 px-1 py-0.5 rounded text-xs">g</kbd>
                    {' '}/{' '}
                    <kbd className="bg-gray-100 border border-gray-200 px-1 py-0.5 rounded text-xs">m</kbd>
                    {' '}/{' '}
                    <kbd className="bg-gray-100 border border-gray-200 px-1 py-0.5 rounded text-xs">i</kbd>
                    {' · '}
                    <kbd className="bg-gray-100 border border-gray-200 px-1 py-0.5 rounded text-xs">s</kbd> skip
                    {' '}
                    <kbd className="bg-gray-100 border border-gray-200 px-1 py-0.5 rounded text-xs">r</kbd> repo
                    {' '}
                    <kbd className="bg-gray-100 border border-gray-200 px-1 py-0.5 rounded text-xs">c</kbd> notes
                  </span>
                </p>
                <div className="flex gap-2 mb-3">
                  <button
                    onClick={() => handleReview('good')}
                    disabled={saving}
                    className={`flex-1 py-2 px-3 rounded-lg font-medium text-sm transition-colors disabled:opacity-50 ${
                      reviewStatus === 'good'
                        ? 'bg-green-600 text-white ring-2 ring-green-500 ring-offset-1'
                        : 'bg-green-50 text-green-700 hover:bg-green-100 border border-green-200'
                    }`}
                  >
                    ✓ Good
                  </button>
                  <button
                    onClick={() => handleReview('minor_issue')}
                    disabled={saving}
                    className={`flex-1 py-2 px-3 rounded-lg font-medium text-sm transition-colors disabled:opacity-50 ${
                      reviewStatus === 'minor_issue'
                        ? 'bg-amber-500 text-white ring-2 ring-amber-400 ring-offset-1'
                        : 'bg-amber-50 text-amber-700 hover:bg-amber-100 border border-amber-200'
                    }`}
                  >
                    ⚠ Minor Issue
                  </button>
                  <button
                    onClick={() => handleReview('major_issue')}
                    disabled={saving}
                    className={`flex-1 py-2 px-3 rounded-lg font-medium text-sm transition-colors disabled:opacity-50 ${
                      reviewStatus === 'major_issue'
                        ? 'bg-red-600 text-white ring-2 ring-red-500 ring-offset-1'
                        : 'bg-red-50 text-red-700 hover:bg-red-100 border border-red-200'
                    }`}
                  >
                    ✖ Major Issue
                  </button>
                </div>
                <textarea
                  ref={textareaRef}
                  defaultValue=""
                  placeholder="Notes (optional)…"
                  rows={3}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                {saving && <p className="text-xs text-gray-400 mt-1">Saving…</p>}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function FieldCard({
  label,
  value,
  fallback,
  isLink,
}: {
  label: string;
  value?: string;
  fallback?: string;
  isLink?: boolean;
}) {
  const display = value ?? fallback;
  return (
    <div className="p-3 bg-white border border-gray-200 rounded-lg">
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1">{label}</p>
      {isLink && display ? (
        <a
          href={display.startsWith('http') ? display : `https://${display}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-blue-600 hover:underline break-all"
        >
          {display}
        </a>
      ) : (
        <p className={`text-sm ${display ? 'text-gray-900' : 'text-gray-300'}`}>
          {display ?? '—'}
        </p>
      )}
    </div>
  );
}
