import { NextRequest } from 'next/server';
import { q, qOne } from '@/lib/db';
import { subscribeToJob } from '@/lib/events';
import { apiError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id: jobId } = await context.params;

  const job = qOne<{ id: string; status: string }>(
    `SELECT id, status FROM expansion_jobs WHERE id = $1`,
    jobId
  );
  if (!job) {
    return apiError('Expansion job not found', 404, 'NOT_FOUND', false);
  }

  // Parse Last-Event-ID header or query parameter
  const lastEventIdHeader = req.headers.get('last-event-id');
  const { searchParams } = new URL(req.url);
  const lastEventIdParam = searchParams.get('lastEventId');
  const lastEventIdStr = lastEventIdHeader || lastEventIdParam;

  let lastSequence = 0;
  if (lastEventIdStr) {
    const existingEvt = qOne<{ sequence_number: number }>(
      `SELECT sequence_number FROM expansion_events WHERE id = $1`,
      lastEventIdStr
    );
    if (existingEvt) {
      lastSequence = existingEvt.sequence_number;
    }
  }

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      function sendEvent(data: { id: string; eventType: string; payload: any }) {
        const payloadStr = JSON.stringify(data.payload);
        const msg = `id: ${data.id}\nevent: ${data.eventType}\ndata: ${payloadStr}\n\n`;
        controller.enqueue(encoder.encode(msg));
      }

      function sendComment(comment: string) {
        controller.enqueue(encoder.encode(`: ${comment}\n\n`));
      }

      // 1. Replay historical events after lastSequence
      const historicalEvents = q<{
        id: string;
        sequence_number: number;
        event_type: string;
        payload: any;
      }>(
        `SELECT id, sequence_number, event_type, payload 
         FROM expansion_events 
         WHERE job_id = $1 AND sequence_number > $2 
         ORDER BY sequence_number ASC`,
        jobId,
        lastSequence
      );

      for (const ev of historicalEvents) {
        sendEvent({
          id: ev.id,
          eventType: ev.event_type,
          payload: ev.payload,
        });
      }

      // 2. Periodic keepalive comment every 15 seconds
      const keepAliveInterval = setInterval(() => {
        try {
          sendComment('keepalive');
        } catch {
          clearInterval(keepAliveInterval);
        }
      }, 15000);

      // Check if job is already terminal and all events are drained
      const terminalStatuses = new Set(['COMPLETED', 'PARTIAL', 'FAILED', 'CANCELLED']);
      const currentJob = qOne<{ status: string }>(
        `SELECT status FROM expansion_jobs WHERE id = $1`,
        jobId
      );

      if (currentJob && terminalStatuses.has(currentJob.status)) {
        clearInterval(keepAliveInterval);
        controller.close();
        return;
      }

      // 3. Subscribe to real-time events
      const unsubscribe = subscribeToJob(jobId, (event) => {
        try {
          sendEvent({
            id: event.id,
            eventType: event.eventType,
            payload: event.payload,
          });

          if (
            ['expansion.completed', 'expansion.partial', 'expansion.failed', 'expansion.cancelled'].includes(
              event.eventType
            )
          ) {
            clearInterval(keepAliveInterval);
            unsubscribe();
            controller.close();
          }
        } catch {
          clearInterval(keepAliveInterval);
          unsubscribe();
        }
      });

      // Cleanup on client disconnect
      req.signal.addEventListener('abort', () => {
        clearInterval(keepAliveInterval);
        unsubscribe();
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}

