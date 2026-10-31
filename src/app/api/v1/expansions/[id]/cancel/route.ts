import { NextRequest, NextResponse } from 'next/server';
import { qOne, qRun } from '@/lib/db';
import { apiError } from '@/lib/errors';
import { emitEvent } from '@/lib/events';

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id: jobId } = await context.params;

    const job = qOne<{ id: string; status: string }>(
      `SELECT id, status FROM expansion_jobs WHERE id = $1`,
      jobId
    );

    if (!job) {
      return apiError('Expansion job not found', 404, 'NOT_FOUND', false);
    }

    const terminalStatuses = new Set(['COMPLETED', 'PARTIAL', 'FAILED', 'CANCELLED']);
    if (terminalStatuses.has(job.status)) {
      return NextResponse.json({
        id: jobId,
        status: job.status,
        message: 'Job is already in a terminal state',
      });
    }

    // Set cancel_requested flag and notify
    qRun(
      `UPDATE expansion_jobs SET cancel_requested = 1, updated_at = $1 WHERE id = $2`,
      new Date().toISOString(),
      jobId
    );

    emitEvent(jobId, 'expansion.cancelled', { reason: 'cancel_requested_by_user' });

    return NextResponse.json({
      id: jobId,
      status: 'CANCELLING',
      message: 'Cancellation requested successfully',
    });
  } catch (error: any) {
    return apiError(error?.message || 'Failed to cancel job', 500, 'INTERNAL_SERVER_ERROR', true);
  }
}

