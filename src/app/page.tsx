'use client';

import React, { useState, useEffect } from 'react';
import { Logo } from '@/components/Logo';
import { WorkspaceShell } from '@/components/WorkspaceShell';

interface InvestigationSummary {
  id: string;
  title: string;
  root_subject: string;
  version: number;
  created_at: string;
}

export default function Home() {
  const [activeInvestigationId, setActiveInvestigationId] = useState<string | null>(null);
  const [subject, setSubject] = useState('');
  const [type, setType] = useState('company');
  const [submitting, setSubmitting] = useState(false);
  const [investigations, setInvestigations] = useState<InvestigationSummary[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Load recent investigations
  async function fetchInvestigations() {
    try {
      setLoadingList(true);
      const res = await fetch('/api/v1/investigations');
      if (res.ok) {
        const json = await res.json();
        setInvestigations(json.investigations || []);
      }
    } catch (err: any) {
      console.error('Failed to fetch investigations:', err);
    } finally {
      setLoadingList(false);
    }
  }

  useEffect(() => {
    fetchInvestigations();
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!subject.trim() || submitting) return;

    setSubmitting(true);
    setErrorMessage(null);

    try {
      const res = await fetch('/api/v1/investigations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject: subject.trim(), type }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.error?.message || 'Failed to start investigation');
      }

      setSubject('');
      // Open the workspace shell directly
      setActiveInvestigationId(data.investigationId);
      fetchInvestigations();
    } catch (err: any) {
      setErrorMessage(err.message || 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  }

  if (activeInvestigationId) {
    return (
      <WorkspaceShell
        investigationId={activeInvestigationId}
        onBack={() => {
          setActiveInvestigationId(null);
          fetchInvestigations();
        }}
      />
    );
  }

  return (
    <div className="flex-1 flex flex-col justify-between p-6 md:p-12 max-w-5xl mx-auto w-full">
      {/* Top Navbar */}
      <header className="flex items-center justify-between py-2 border-b border-[#14213d]/10 pb-6">
        <Logo size={36} />
        <div className="text-xs text-[#14213d]/60 font-medium">
          Hackathon Edition • Evidence-Backed Graph Engine
        </div>
      </header>

      {/* Hero & Input Area */}
      <main className="my-auto py-12 flex flex-col items-center text-center max-w-2xl mx-auto w-full">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#2457d6]/10 border border-[#2457d6]/20 text-[#2457d6] text-xs font-semibold uppercase tracking-wider mb-6">
          <span>Continuous Evidence Graph</span>
        </div>

        <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight text-[#14213d] mb-4">
          Click anything. <br />
          <span className="text-[#2457d6]">Follow the evidence.</span>
        </h1>

        <p className="text-base text-[#14213d]/70 max-w-lg mb-8">
          Turn any company, claim, or relationship into an immutable investigation graph
          grounded in primary source verification.
        </p>

        {/* Company Input Form */}
        <form onSubmit={handleCreate} className="w-full flex flex-col sm:flex-row gap-2 max-w-lg">
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Enter company or entity (e.g. OpenAI, Stripe)..."
            required
            className="control-40 flex-1 px-4 text-sm bg-white border border-[#14213d]/20 rounded focus:outline-none focus:border-[#2457d6] text-[#14213d] placeholder:text-[#14213d]/40 shadow-xs"
          />
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="control-40 px-3 text-xs bg-white border border-[#14213d]/20 rounded focus:outline-none focus:border-[#2457d6] text-[#14213d] cursor-pointer shadow-xs"
          >
            <option value="company">Company</option>
            <option value="person">Person</option>
            <option value="topic">Topic</option>
            <option value="claim">Claim</option>
          </select>
          <button
            type="submit"
            disabled={submitting || !subject.trim()}
            className="control-40 px-5 text-sm font-semibold bg-[#14213d] hover:bg-[#2457d6] text-white rounded transition-colors disabled:opacity-50 disabled:pointer-events-none cursor-pointer shadow-xs shrink-0"
          >
            {submitting ? 'Starting...' : 'Investigate'}
          </button>
        </form>

        {errorMessage && (
          <div className="mt-3 text-xs text-red-600 bg-red-50 border border-red-200 px-3 py-1.5 rounded">
            {errorMessage}
          </div>
        )}
      </main>

      {/* Recent Investigations List */}
      <footer className="border-t border-[#14213d]/10 pt-8 mt-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xs font-bold uppercase tracking-wider text-[#14213d]/60">
            Recent Investigations
          </h2>
          <span className="text-xs text-[#14213d]/40">
            {investigations.length} recorded
          </span>
        </div>

        {loadingList ? (
          <div className="text-xs text-[#14213d]/40 py-4 text-center">Loading investigations...</div>
        ) : investigations.length === 0 ? (
          <div className="text-xs text-[#14213d]/40 py-6 text-center border border-dashed border-[#14213d]/15 rounded bg-white/40">
            No investigations yet. Enter an entity above to create the first graph.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
            {investigations.map((inv) => (
              <button
                key={inv.id}
                onClick={() => setActiveInvestigationId(inv.id)}
                className="p-3.5 bg-white border border-[#14213d]/15 rounded hover:border-[#2457d6] hover:bg-[#2457d6]/[0.02] text-left transition-all cursor-pointer shadow-2xs group"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-bold text-[#14213d] group-hover:text-[#2457d6] truncate">
                    {inv.title}
                  </span>
                  <span className="text-[10px] px-1.5 py-0.2 rounded bg-[#14213d]/5 text-[#14213d]/60 font-mono">
                    v{inv.version}
                  </span>
                </div>
                <div className="text-[11px] text-[#14213d]/50 truncate">
                  Subject: {inv.root_subject}
                </div>
                <div className="text-[10px] text-[#14213d]/40 mt-2 font-mono">
                  {new Date(inv.created_at).toLocaleDateString()}
                </div>
              </button>
            ))}
          </div>
        )}
      </footer>
    </div>
  );
}

