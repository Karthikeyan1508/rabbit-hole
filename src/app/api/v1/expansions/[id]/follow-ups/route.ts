import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { q, qOne } from '@/lib/db';
import { apiError } from '@/lib/errors';
import { groqStructuredCall } from '@/lib/groq';

const followUpResponseSchema = z.object({
  followUps: z.array(
    z.object({
      targetType: z.enum(['entity', 'claim', 'edge']),
      targetId: z.string(),
      question: z.string(),
      rationale: z.string(),
    })
  ),
});

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id: jobId } = await context.params;

    const job = qOne<{ id: string; investigation_id: string; target_id: string; question: string }>(
      `SELECT id, investigation_id, target_id, question FROM expansion_jobs WHERE id = $1`,
      jobId
    );

    if (!job) {
      return apiError('Expansion job not found', 404, 'NOT_FOUND', false);
    }

    // Fetch newly discovered claims and nodes from this investigation
    const recentClaims = q<{ id: string; predicate: string; object_node_id: string; value: any }>(
      `SELECT c.id, c.predicate, c.object_node_id, c.value 
       FROM claims c
       WHERE c.investigation_id = $1
       ORDER BY c.rowid DESC LIMIT 10`,
      job.investigation_id
    );

    const promptContext = `Original Question: ${job.question}
Recent Claims:
${recentClaims.map((c) => `- Claim ${c.id}: ${c.predicate} -> ${JSON.stringify(c.value)}`).join('\n')}`;

    let followUps = [];
    try {
      const result = await groqStructuredCall(
        followUpResponseSchema,
        'You are an investigative journalist and fact-checking intelligence system. Suggest 3 high-impact follow-up questions targeting the claims or entities discovered.',
        promptContext
      );
      followUps = result.followUps;
    } catch {
      // Deterministic fallback if model call unavailable
      followUps = recentClaims.slice(0, 3).map((c) => ({
        targetType: 'claim' as const,
        targetId: c.id,
        question: `Verify secondary sources and provenance for ${c.predicate}`,
        rationale: 'Deepen evidence chain and corroboration',
      }));
    }

    return NextResponse.json({
      jobId,
      followUps,
    });
  } catch (error: any) {
    return apiError(error?.message || 'Failed to generate follow-ups', 500, 'INTERNAL_SERVER_ERROR', true);
  }
}

