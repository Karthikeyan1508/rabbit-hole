'use client';

import React, { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { Logo } from '@/components/Logo';
import type { GraphNodeItem, GraphEdgeItem } from '@/components/GraphCanvas';

const DynamicGraphCanvas = dynamic(() => import('@/components/GraphCanvas'), {
  ssr: false,
  loading: () => (
    <div className="flex-1 flex items-center justify-center text-sm text-[#14213d]/60">
      Loading graph canvas...
    </div>
  ),
});

interface InvestigationDetails {
  investigationId: string;
  title: string;
  rootSubject: string;
  currentVersion: number;
  nodes: GraphNodeItem[];
  edges: GraphEdgeItem[];
}

interface WorkspaceShellProps {
  investigationId: string;
  onBack: () => void;
}

export function WorkspaceShell({ investigationId, onBack }: WorkspaceShellProps) {
  const [data, setData] = useState<InvestigationDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNodeItem | null>(null);

  useEffect(() => {
    async function loadGraph() {
      try {
        setLoading(true);
        setError(null);
        const res = await fetch(`/api/v1/investigations/${investigationId}/graph`);
        if (!res.ok) {
          const errText = await res.text().catch(() => "");
          let errData: any = {};
          try { errData = errText ? JSON.parse(errText) : {}; } catch {}
          throw new Error(errData?.error?.message || errText || 'Failed to fetch graph data');
        }
        const text = await res.text();
        const json = text ? JSON.parse(text) : {};
        setData(json);
        if (json.nodes && json.nodes.length > 0) {
          setSelectedNode(json.nodes[0]);
        }
      } catch (err: any) {
        setError(err.message || 'Error loading investigation');
      } finally {
        setLoading(false);
      }
    }

    loadGraph();
  }, [investigationId]);

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-[#fbfbfd]">
      {/* Top Header */}
      <header className="h-[52px] border-b border-[#14213d]/10 px-4 flex items-center justify-between bg-white shrink-0">
        <div className="flex items-center gap-4">
          <button
            onClick={onBack}
            className="control-40 px-3 flex items-center gap-1.5 text-xs font-semibold text-[#14213d]/70 hover:text-[#14213d] hover:bg-[#14213d]/5 rounded border border-[#14213d]/15 transition-colors cursor-pointer"
          >
            ← Back
          </button>
          <Logo size={24} />
          <div className="h-4 w-px bg-[#14213d]/20 mx-1" />
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-[#14213d]/50">Investigation:</span>
            <span className="text-sm font-semibold text-[#14213d]">
              {data?.title || 'Loading...'}
            </span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#2457d6]/10 text-[#2457d6] font-medium border border-[#2457d6]/20">
              v{data?.currentVersion ?? 1}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="text-xs text-[#14213d]/60 bg-[#14213d]/5 px-2.5 py-1 rounded border border-[#14213d]/10">
            {data?.nodes?.length ?? 0} {data?.nodes?.length === 1 ? 'node' : 'nodes'} • {data?.edges?.length ?? 0} edges
          </div>
        </div>
      </header>

      {/* Main Workspace Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Sidebar */}
        <aside className="w-64 border-r border-[#14213d]/10 bg-white flex flex-col shrink-0">
          <div className="p-3 border-b border-[#14213d]/10">
            <h2 className="text-xs font-bold uppercase tracking-wider text-[#14213d]/60">
              Graph Entities
            </h2>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {data?.nodes.map((node) => {
              const isSelected = selectedNode?.id === node.id;
              return (
                <button
                  key={node.id}
                  onClick={() => setSelectedNode(node)}
                  className={`w-full text-left p-2.5 rounded text-xs transition-colors cursor-pointer flex items-center justify-between border ${
                    isSelected
                      ? 'bg-[#2457d6]/10 border-[#2457d6]/30 text-[#14213d] font-medium'
                      : 'border-transparent hover:bg-[#14213d]/5 text-[#14213d]/80'
                  }`}
                >
                  <div className="truncate mr-2">
                    <div className="font-semibold truncate">{node.label}</div>
                    <div className="text-[11px] text-[#14213d]/50 capitalize">{node.type}</div>
                  </div>
                  {node.properties?.isRoot && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#14213d] text-white shrink-0">
                      ROOT
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </aside>

        {/* Center: Graph Canvas Area */}
        <main className="flex-1 flex flex-col relative bg-[#fbfbfd] min-w-0">
          <div className="flex-1 relative">
            {loading ? (
              <div className="absolute inset-0 flex items-center justify-center text-xs text-[#14213d]/50">
                Fetching graph nodes...
              </div>
            ) : error ? (
              <div className="absolute inset-0 flex items-center justify-center text-xs text-red-600 bg-red-50/50 p-4">
                {error}
              </div>
            ) : (
              <DynamicGraphCanvas
                nodes={data?.nodes || []}
                edges={data?.edges || []}
                selectedNode={selectedNode}
                onSelectNode={(node) => setSelectedNode(node)}
              />
            )}
          </div>

          {/* Bottom Activity Area */}
          <section className="h-44 border-t border-[#14213d]/10 bg-white flex flex-col shrink-0">
            <div className="h-8 border-b border-[#14213d]/10 px-3 flex items-center justify-between bg-[#14213d]/[0.02]">
              <span className="text-xs font-bold uppercase tracking-wider text-[#14213d]/60">
                Activity & Audit Log
              </span>
              <span className="text-[11px] text-[#14213d]/50">Live audit trail</span>
            </div>
            <div className="flex-1 overflow-y-auto p-3 text-xs space-y-2 font-mono">
              <div className="flex items-center gap-2 text-[#14213d]/70">
                <span className="text-[#2457d6]">•</span>
                <span>Root investigation established for &quot;{data?.rootSubject}&quot;</span>
                <span className="text-[#14213d]/30 text-[10px]">
                  {data?.nodes[0]?.version ? `(v${data.nodes[0].version})` : ''}
                </span>
              </div>
              <div className="flex items-center gap-2 text-[#14213d]/60">
                <span className="text-[#d97706]">•</span>
                <span>Graph node created: {data?.nodes[0]?.canonical_key || 'pending'}</span>
              </div>
              <div className="flex items-center gap-2 text-[#14213d]/40">
                <span className="text-emerald-600">•</span>
                <span>SQLite storage initialized & synced</span>
              </div>
            </div>
          </section>
        </main>

        {/* Right Inspector */}
        <aside className="w-80 border-l border-[#14213d]/10 bg-white flex flex-col shrink-0">
          <div className="p-3 border-b border-[#14213d]/10 flex items-center justify-between">
            <h2 className="text-xs font-bold uppercase tracking-wider text-[#14213d]/60">
              Inspector
            </h2>
            {selectedNode && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#14213d]/5 text-[#14213d]/70 capitalize border border-[#14213d]/10">
                {selectedNode.type}
              </span>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {selectedNode ? (
              <div className="space-y-4">
                <div>
                  <label className="text-[11px] font-semibold text-[#14213d]/60 uppercase tracking-wide block mb-1">
                    Node Label
                  </label>
                  <p className="text-sm font-bold text-[#14213d]">{selectedNode.label}</p>
                </div>

                <div>
                  <label className="text-[11px] font-semibold text-[#14213d]/60 uppercase tracking-wide block mb-1">
                    Canonical Key
                  </label>
                  <p className="text-xs font-mono text-[#14213d]/80 bg-[#14213d]/5 p-2 rounded border border-[#14213d]/10">
                    {selectedNode.canonical_key}
                  </p>
                </div>

                <div>
                  <label className="text-[11px] font-semibold text-[#14213d]/60 uppercase tracking-wide block mb-1">
                    Node ID
                  </label>
                  <p className="text-[11px] font-mono text-[#14213d]/70 break-all">
                    {selectedNode.id}
                  </p>
                </div>

                <div>
                  <label className="text-[11px] font-semibold text-[#14213d]/60 uppercase tracking-wide block mb-1">
                    Properties
                  </label>
                  <pre className="text-[11px] font-mono bg-[#14213d]/5 p-2.5 rounded border border-[#14213d]/10 text-[#14213d] overflow-x-auto">
                    {JSON.stringify(selectedNode.properties || {}, null, 2)}
                  </pre>
                </div>

                <div className="pt-3 border-t border-[#14213d]/10">
                  <div className="p-3 bg-[#d97706]/10 border border-[#d97706]/20 rounded text-xs text-[#14213d]">
                    <div className="font-semibold text-[#d97706] mb-1">Evidence Trail</div>
                    <p className="text-[#14213d]/70 text-[11px]">
                      Every factual claim and edge in RabbitHole traces directly to a cited source and excerpt.
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-xs text-[#14213d]/40 italic text-center py-8">
                Select a node to inspect claims and evidence
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

