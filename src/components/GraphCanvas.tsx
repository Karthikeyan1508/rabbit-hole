'use client';

import React, { useEffect, useRef } from 'react';
import ForceGraph2D from 'react-force-graph-2d';

export interface GraphNodeItem {
  id: string;
  canonical_key: string;
  type: string;
  label: string;
  properties?: Record<string, any>;
  version: number;
}

export interface GraphEdgeItem {
  id: string;
  from_node_id: string;
  to_node_id: string;
  relation: string;
  status: string;
  claim_id?: string;
  properties?: Record<string, any>;
  version: number;
}

interface GraphCanvasProps {
  nodes: GraphNodeItem[];
  edges: GraphEdgeItem[];
  selectedNode: GraphNodeItem | null;
  onSelectNode: (node: GraphNodeItem) => void;
}

export default function GraphCanvas({
  nodes,
  edges,
  selectedNode,
  onSelectNode,
}: GraphCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = React.useState({ width: 600, height: 400 });

  useEffect(() => {
    function updateDimensions() {
      if (containerRef.current) {
        setDimensions({
          width: containerRef.current.clientWidth || 600,
          height: containerRef.current.clientHeight || 400,
        });
      }
    }

    updateDimensions();
    window.addEventListener('resize', updateDimensions);
    return () => window.removeEventListener('resize', updateDimensions);
  }, []);

  const graphData = {
    nodes: nodes.map((n) => ({
      ...n,
      val: n.properties?.isRoot ? 14 : 10,
    })),
    links: edges.map((e) => ({
      ...e,
      source: e.from_node_id,
      target: e.to_node_id,
    })),
  };

  return (
    <div ref={containerRef} className="w-full h-full relative overflow-hidden bg-white/70">
      <ForceGraph2D
        width={dimensions.width}
        height={dimensions.height}
        graphData={graphData}
        nodeLabel={(n: any) => `${n.label} (${n.type})`}
        nodeColor={(n: any) => {
          if (n.id === selectedNode?.id) return '#d97706';
          if (n.properties?.isRoot) return '#14213d';
          return '#2457d6';
        }}
        nodeCanvasObject={(node: any, ctx, globalScale) => {
          const isSelected = node.id === selectedNode?.id;
          const isRoot = !!node.properties?.isRoot;
          const radius = isRoot ? 9 : 7;

          // Circle fill
          ctx.beginPath();
          ctx.arc(node.x, node.y, radius, 0, 2 * Math.PI, false);
          ctx.fillStyle = isSelected ? '#d97706' : isRoot ? '#14213d' : '#2457d6';
          ctx.fill();

          // Stroke ring
          ctx.lineWidth = isSelected ? 2.5 : 1.5;
          ctx.strokeStyle = isSelected ? '#14213d' : '#ffffff';
          ctx.stroke();

          // Text label
          const label = node.label || node.canonical_key;
          const fontSize = Math.max(11 / globalScale, 3.5);
          ctx.font = `${isSelected ? '600' : '400'} ${fontSize}px sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';
          ctx.fillStyle = '#14213d';
          ctx.fillText(label, node.x, node.y + radius + 3);
        }}
        linkColor={() => 'rgba(20, 33, 61, 0.25)'}
        linkWidth={1.5}
        onNodeClick={(node: any) => {
          onSelectNode(node as GraphNodeItem);
        }}
        cooldownTicks={100}
      />
    </div>
  );
}
