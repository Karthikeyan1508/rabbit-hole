import { q } from "./db";
import { isDue } from "./due";
import { createExpansion } from "./worker";

const g = globalThis as unknown as { __watcher?: NodeJS.Timeout };

// shortcut: in-process timer, so checks only run while the server is up; use a cron or queue for always-on monitoring
export function startWatcher() {
  g.__watcher ??= setInterval(() => void tick().catch(() => {}), 60_000);
}

async function tick() {
  for (const i of await q("select id, watch_hours, last_watch_at from investigations where watch_hours > 0"))
    if (isDue(i.last_watch_at, i.watch_hours, Date.now())) await check(i.id).catch(() => {});
}

/** Re-investigate the root entity for recent changes. The watch: key marks the run as scheduled. */
export async function check(invId: string) {
  const [root] = await q("select id from graph_nodes where investigation_id=$1 order by rowid limit 1", [invId]);
  if (!root) throw new Error("Empty investigation");
  const r = await createExpansion(invId, {
    target: { type: "entity", id: root.id }, config: { mode: "quick" },
    question: "What is new or changed recently? Latest announcements, products, funding and partnerships.",
  }, `watch:${Date.now()}`);
  await q("update investigations set last_watch_at=$2 where id=$1", [invId, new Date().toISOString()]);
  return r.job;
}
