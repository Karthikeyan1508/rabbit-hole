import { NextRequest, NextResponse } from 'next/server';
import { q, qOne } from '@/lib/db';
import { apiError } from '@/lib/errors';

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;

    if (!id) {
      return apiError('Investigation ID is required', 400, 'MISSING_ID', false);
    }

    // Check if investigation exists
    const investigation = qOne<{
      id: string;
      title: string;
      root_subject: string;
      version: number;
    }>(
      `SELECT id, title, root_subject, version FROM investigations WHERE id = $1`,
      id
    );

    if (!investigation) {
      return apiError('Investigation not found', 404, 'NOT_FOUND', false);
    }

    const { searchParams } = new URL(req.url);
    const sinceVersionParam = searchParams.get('sinceVersion');
    const sinceVersion = sinceVersionParam ? parseInt(sinceVersionParam, 10) : 0;

    // Fetch nodes newer than sinceVersion
    const nodes = q(
      `SELECT id, investigation_id, canonical_key, type, label, properties, version, created_at 
       FROM graph_nodes 
       WHERE investigation_id = $1 AND version > $2 
       ORDER BY created_at ASC`,
      id,
      sinceVersion
    );

    // Fetch edges newer than sinceVersion
    const edges = q(
      `SELECT id, investigation_id, from_node_id, to_node_id, relation, status, claim_id, properties, version 
       FROM graph_edges 
       WHERE investigation_id = $1 AND version > $2`,
      id,
      sinceVersion
    );

    return NextResponse.json({
      investigationId: investigation.id,
      title: investigation.title,
      rootSubject: investigation.root_subject,
      currentVersion: investigation.version,
      nodes,
      edges,
    });
  } catch (error: any) {
    return apiError(
      error?.message || 'Failed to retrieve graph',
      500,
      'INTERNAL_SERVER_ERROR',
      true
    );
  }
}

