import { q } from "./db";
import { isDue } from "./due";
import { createExpansion } from "./worker";

const g = globalThis as unknown as { __watcher?: NodeJS.Timeout };

/**
 * In-process timer checking every 60 seconds.
 * Triggers automated monitoring for any investigation whose watch interval has elapsed.
 */
export function startWatcher() {
  g.__watcher ??= setInterval(() => void tick().catch(() => {}), 60_000);
}

async function tick() {
  const dueItems = await q(
    "select id, watch_hours, last_watch_at from investigations where watch_hours > 0"
  );
  for (const i of dueItems) {
    if (isDue(i.last_watch_at, i.watch_hours, Date.now())) {
      await check(i.id, false).catch(() => {});
    }
  }
}

/**
 * Re-investigates the target for changes over the specific interval.
 * @param invId The investigation ID
 * @param isManual True if initiated by the 'Check now' button
 */
export async function check(invId: string, isManual = false) {
  const [inv] = await q(
    "select title, root_subject, watch_hours from investigations where id=$1",
    [invId]
  );
  const [root] = await q(
    "select id, label from graph_nodes where investigation_id=$1 order by rowid limit 1",
    [invId]
  );
  if (!root) throw new Error("Empty investigation: root node not found");

  const targetName = root.label || inv?.root_subject || inv?.title || "Entity";
  const hours = inv?.watch_hours || 6;
  
  // Specific interval-based research query
  const timeWindow = isManual
    ? "latest developments, breaking news, new products, and recent partnerships"
    : hours <= 6
    ? "events, product updates, partnership announcements, and news from the past 6 hours"
    : hours <= 24
    ? "announcements, launches, funding, and leadership changes from the past 24 hours"
    : `announcements, launches, and updates from the past ${Math.round(hours / 24)} days`;

  const question = `What happened with ${targetName}? Focus strictly on ${timeWindow}.`;

  const r = await createExpansion(
    invId,
    {
      target: { type: "entity", id: root.id },
      config: { mode: "quick", maxSources: 12 },
      question,
    },
    `watch:${isManual ? "manual" : "auto"}:${Date.now()}`
  );

  await q(
    "update investigations set last_watch_at=$2 where id=$1",
    [invId, new Date().toISOString()]
  );

  return r.job;
}
