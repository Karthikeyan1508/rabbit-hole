import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { q, qRun, tx } from '@/lib/db';
import { apiError } from '@/lib/errors';

const createInvestigationSchema = z.object({
  subject: z.string().min(1, 'Subject is required').max(300),
  type: z.string().optional().default('company'),
});

export async function GET() {
  try {
    const investigations = q(
      `SELECT id, owner_id, title, root_subject, version, watch_hours, last_watch_at, created_at, updated_at 
       FROM investigations 
       ORDER BY created_at DESC 
       LIMIT 50`
    );

    return NextResponse.json({
      investigations,
    });
  } catch (error: any) {
    return apiError(
      error?.message || 'Failed to fetch investigations',
      500,
      'INTERNAL_SERVER_ERROR',
      true
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return apiError('Invalid JSON request body', 400, 'INVALID_JSON', false);
    }

    const parseResult = createInvestigationSchema.safeParse(body);
    if (!parseResult.success) {
      return apiError(
        'Validation failed',
        400,
        'VALIDATION_ERROR',
        false,
        parseResult.error.flatten()
      );
    }

    const { subject, type } = parseResult.data;
    const now = new Date().toISOString();
    const investigationId = `inv_${randomUUID().replace(/-/g, '')}`;
    const nodeId = `node_${randomUUID().replace(/-/g, '')}`;

    // Canonical key derived from subject (trimmed and lowercased)
    const canonicalKey = subject.trim().toLowerCase();

    tx(() => {
      // 1. Create Investigation
      qRun(
        `INSERT INTO investigations (
          id, owner_id, title, root_subject, version, watch_hours, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        investigationId,
        null,
        subject.trim(),
        subject.trim(),
        1,
        24,
        now,
        now
      );

      // 2. Create Root Node
      qRun(
        `INSERT INTO graph_nodes (
          id, investigation_id, canonical_key, type, label, properties, version, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        nodeId,
        investigationId,
        canonicalKey,
        type || 'company',
        subject.trim(),
        JSON.stringify({ isRoot: true }),
        1,
        now
      );
    });

    return NextResponse.json(
      {
        investigationId,
        rootNodeId: nodeId,
        title: subject.trim(),
        rootSubject: subject.trim(),
        type: type || 'company',
        version: 1,
        createdAt: now,
      },
      { status: 201 }
    );
  } catch (error: any) {
    return apiError(
      error?.message || 'Failed to create investigation',
      500,
      'INTERNAL_SERVER_ERROR',
      true
    );
  }
}

