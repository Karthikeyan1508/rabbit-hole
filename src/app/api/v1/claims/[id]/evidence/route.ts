import { NextRequest, NextResponse } from 'next/server';
import { q, qOne } from '@/lib/db';
import { apiError } from '@/lib/errors';

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id: claimId } = await context.params;

    const claim = qOne(
      `SELECT id, investigation_id, subject_node_id, predicate, object_node_id, value,
              valid_from, valid_to, verification_status
       FROM claims WHERE id = $1`,
      claimId
    );

    if (!claim) {
      return apiError('Claim not found', 404, 'NOT_FOUND', false);
    }

    const evidenceList = q(
      `SELECT ce.id, ce.claim_id, ce.source_id, ce.excerpt, ce.start_offset, ce.end_offset,
              ce.support_verdict, ce.verification_metadata,
              s.canonical_url, s.title as source_title, s.publisher, s.content_hash, s.retrieved_at
       FROM claim_evidence ce
       JOIN sources s ON s.id = ce.source_id
       WHERE ce.claim_id = $1`,
      claimId
    );

    return NextResponse.json({
      claim,
      evidence: evidenceList,
    });
  } catch (error: any) {
    return apiError(error?.message || 'Failed to retrieve evidence', 500, 'INTERNAL_SERVER_ERROR', true);
  }
}

