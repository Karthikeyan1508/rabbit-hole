import { q } from "./db";
import { keyOf } from "./verify";
import { createExpansion, TERMINAL } from "./worker";

export async function createInvestigation(subject: string, type = "Company") {
  const [inv] = await q("insert into investigations (title, root_subject) values ($1,$1) returning id", [subject]);
  const [n] = await q(
    "insert into graph_nodes (investigation_id, canonical_key, type, label, version) values ($1,$2,$3,$4,0) returning id", [inv.id, keyOf(subject), type, subject]);
  return { id: inv.id as string, rootNodeId: n.id as string };
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function settle(jobId: string) {
  for (let i = 0; i < 120; i++) { // up to ~6 minutes per company
    const [j] = await q("select status from expansion_jobs where id=$1", [jobId]);
    if (!j || TERMINAL.includes(j.status)) return;
    await sleep(3000);
  }
}

/** Create one investigation per company and research them one after another (model rate limits make parallel runs counterproductive). */
// shortcut: the queue lives in this process; a server restart drops the companies that have not started yet
export async function startBulk(subjects: string[]) {
  const made = [];
  for (const s of subjects) made.push({ subject: s, ...(await createInvestigation(s)) });
  void (async () => {
    for (const m of made) {
      try {
        const { job } = await createExpansion(m.id, {
          target: { type: "entity", id: m.rootNodeId }, config: { mode: "quick" },
          question: "Overview: main products, competitors, funding and partnerships",
        });
        await settle(job.id);
      } catch { /* one failing company must not stop the rest */ }
    }
  })();
  return made;
}
