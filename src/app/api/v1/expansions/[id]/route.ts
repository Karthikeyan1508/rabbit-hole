import { NextRequest, NextResponse } from 'next/server';
import { qOne } from '@/lib/db';
import { apiError } from '@/lib/errors';

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;

    const job = qOne(
      `SELECT id, investigation_id, parent_id, idempotency_key, target_type, target_id,
              question, status, stage, budget, usage, cancel_requested, created_at, updated_at, error
       FROM expansion_jobs WHERE id = $1`,
      id
    );

    if (!job) {
      return apiError('Expansion job not found', 404, 'NOT_FOUND', false);
    }

    return NextResponse.json({ job });
  } catch (error: any) {
    return apiError(error?.message || 'Failed to fetch job', 500, 'INTERNAL_SERVER_ERROR', true);
  }
}

