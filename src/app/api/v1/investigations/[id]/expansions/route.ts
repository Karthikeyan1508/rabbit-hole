import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { q, qOne, qRun } from '@/lib/db';
import { apiError } from '@/lib/errors';
import { runExpansionPipeline } from '@/lib/pipeline';

const createExpansionSchema = z.object({
  target: z.object({
    type: z.enum(['entity', 'claim', 'edge']),
    id: z.string().min(1),
  }),
  question: z.string().min(1).max(1000),
  config: z
    .object({
      mode: z.enum(['quick', 'deep']).default('quick'),
      maxDepth: z.number().int().min(1).max(5).default(1),
      maxSources: z.number().int().min(1).max(50).default(12),
      maxAgentRuns: z.number().int().min(0).max(10).default(2),
      allowedDomains: z.array(z.string()).default([]),
    })
    .default({
      mode: 'quick',
      maxDepth: 1,
      maxSources: 12,
      maxAgentRuns: 2,
      allowedDomains: [],
    }),
});

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id: investigationId } = await context.params;

    // 1. Verify investigation exists
    const investigation = qOne<{ id: string }>(
      `SELECT id FROM investigations WHERE id = $1`,
      investigationId
    );
    if (!investigation) {
      return apiError('Investigation not found', 404, 'NOT_FOUND', false);
    }

    // 2. Parse and validate body
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return apiError('Invalid JSON request body', 400, 'INVALID_JSON', false);
    }

    const parseResult = createExpansionSchema.safeParse(body);
    if (!parseResult.success) {
      return apiError(
        'Validation failed',
        400,
        'VALIDATION_ERROR',
        false,
        parseResult.error.flatten()
      );
    }

    const { target, question, config } = parseResult.data;

    // 3. Verify target belongs to investigation
    if (target.type === 'entity') {
      const node = qOne(
        `SELECT id FROM graph_nodes WHERE id = $1 AND investigation_id = $2`,
        target.id,
        investigationId
      );
      if (!node) {
        return apiError('Target entity not found in this investigation', 400, 'TARGET_NOT_FOUND', false);
      }
    } else if (target.type === 'claim') {
      const claim = qOne(
        `SELECT id FROM claims WHERE id = $1 AND investigation_id = $2`,
        target.id,
        investigationId
      );
      if (!claim) {
        return apiError('Target claim not found in this investigation', 400, 'TARGET_NOT_FOUND', false);
      }
    } else if (target.type === 'edge') {
      const edge = qOne(
        `SELECT id FROM graph_edges WHERE id = $1 AND investigation_id = $2`,
        target.id,
        investigationId
      );
      if (!edge) {
        return apiError('Target edge not found in this investigation', 400, 'TARGET_NOT_FOUND', false);
      }
    }

    // 4. Idempotency-Key support
    const idempotencyKey = req.headers.get('idempotency-key');
    if (idempotencyKey) {
      const existingJob = qOne<{ id: string; status: string }>(
        `SELECT id, status FROM expansion_jobs WHERE investigation_id = $1 AND idempotency_key = $2`,
        investigationId,
        idempotencyKey
      );
      if (existingJob) {
        return NextResponse.json(
          {
            id: existingJob.id,
            status: existingJob.status,
            idempotent: true,
          },
          { status: 200 }
        );
      }
    }

    // 5. One active run per investigation check
    const activeJob = qOne<{ id: string; status: string }>(
      `SELECT id, status FROM expansion_jobs 
       WHERE investigation_id = $1 AND status IN ('QUEUED', 'PLANNING', 'DISCOVERING', 'READING', 'EXTRACTING', 'VERIFYING', 'COMMITTING')`,
      investigationId
    );
    if (activeJob) {
      return apiError(
        `An expansion job is already active for this investigation (${activeJob.id})`,
        409,
        'ACTIVE_JOB_CONFLICT',
        true
      );
    }

    // 6. Create Job
    const jobId = `job_${randomUUID().replace(/-/g, '')}`;
    const now = new Date().toISOString();

    qRun(
      `INSERT INTO expansion_jobs (
        id, investigation_id, parent_id, idempotency_key, target_type, target_id,
        question, status, stage, budget, usage, cancel_requested, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      jobId,
      investigationId,
      null,
      idempotencyKey || null,
      target.type,
      target.id,
      question,
      'QUEUED',
      'init',
      JSON.stringify(config),
      JSON.stringify({ searches: 0, sources: 0 }),
      0,
      now,
      now
    );

    // Run pipeline asynchronously in background
    setTimeout(() => {
      runExpansionPipeline(jobId).catch((err) => {
        console.error(`Pipeline execution failed for job ${jobId}:`, err);
      });
    }, 0);

    return NextResponse.json(
      {
        id: jobId,
        investigationId,
        status: 'QUEUED',
        target,
        question,
        config,
        createdAt: now,
      },
      { status: 202 }
    );
  } catch (error: any) {
    return apiError(
      error?.message || 'Failed to create expansion',
      500,
      'INTERNAL_SERVER_ERROR',
      true
    );
  }
}

