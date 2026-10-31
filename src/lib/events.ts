import { randomUUID } from 'node:crypto';
import { q, qRun } from './db.ts';

export interface ExpansionEventData {
  jobId: string;
  eventType: string;
  payload: Record<string, any>;
}

// In-memory subscribers per jobId for real-time SSE dispatch
type Subscriber = (event: { id: string; sequence: number; eventType: string; payload: any; createdAt: string }) => void;
const subscribers = new Map<string, Set<Subscriber>>();

/**
 * Emits an expansion event:
 * 1. Persists to expansion_events in SQLite with incrementing sequence number
 * 2. Broadcasts to active SSE subscribers
 */
export function emitEvent(jobId: string, eventType: string, payload: Record<string, any> = {}): void {
  const now = new Date().toISOString();
  const id = `evt_${randomUUID().replace(/-/g, '')}`;

  // Get next sequence number
  const lastSeqRows = q<{ maxSeq: number | null }>(
    `SELECT MAX(sequence_number) as maxSeq FROM expansion_events WHERE job_id = $1`,
    jobId
  );
  const nextSeq = ((lastSeqRows[0]?.maxSeq) ?? 0) + 1;

  // Persist before publishing
  qRun(
    `INSERT INTO expansion_events (id, job_id, sequence_number, event_type, payload, created_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    id,
    jobId,
    nextSeq,
    eventType,
    JSON.stringify(payload),
    now
  );

  // Broadcast to active SSE listeners
  const listeners = subscribers.get(jobId);
  if (listeners) {
    const eventObj = {
      id,
      sequence: nextSeq,
      eventType,
      payload,
      createdAt: now,
    };
    for (const sub of listeners) {
      try {
        sub(eventObj);
      } catch (err) {
        console.error('Error delivering event to subscriber', err);
      }
    }
  }
}

/**
 * Subscribe to SSE events for a job.
 */
export function subscribeToJob(jobId: string, fn: Subscriber): () => void {
  if (!subscribers.has(jobId)) {
    subscribers.set(jobId, new Set());
  }
  subscribers.get(jobId)!.add(fn);

  return () => {
    const set = subscribers.get(jobId);
    if (set) {
      set.delete(fn);
      if (set.size === 0) {
        subscribers.delete(jobId);
      }
    }
  };
}
