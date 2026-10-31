import { DatabaseSync } from "node:sqlite";
import { SEED_SQL } from "./seed-data";

// Built-in SQLite (Node 22.5+, no dependency). One synchronous connection: awaits inside a transaction never
// interleave with other requests unless real I/O is awaited, so tx() below is effectively atomic.
const g = globalThis as unknown as { __db?: DatabaseSync };

function open() {
  const db = new DatabaseSync(process.env.DB_PATH ?? "rabbit-hole.db");
  db.exec("pragma journal_mode=wal; pragma foreign_keys=on; pragma busy_timeout=5000;");
  db.exec(SCHEMA);
  const have = db.prepare("pragma table_info(investigations)").all().map((c: any) => c.name);
  for (const [n, t] of [["watch_hours", "int not null default 0"], ["watch_webhook", "text"], ["last_watch_at", "text"]])
    if (!have.includes(n)) db.exec(`alter table investigations add column ${n} ${t}`);
  
  // Seed demo data if database is empty
  try {
    const count = (db.prepare("select count(*) as c from investigations").all()[0] as any)?.c ?? 0;
    if (count === 0 && SEED_SQL) {
      db.exec(SEED_SQL);
      console.log("Auto-seeded database with verified TinyFish investigations");
    }
  } catch (e) {
    console.warn("Auto-seed skipped:", e);
  }

  return db;
}

const JSON_COLS = ["properties", "budget", "usage", "payload", "value", "error", "summary", "verification_metadata"];

/** Postgres-style `$1` placeholders in, JSON text columns parsed out. */
export async function q<T = any>(text: string, params: unknown[] = []): Promise<T[]> {
  const db = (g.__db ??= open());
  const actualParams: any[] = [];
  const sql = text.replace(/\$(\d+)/g, (_, idx) => {
    const val = params[parseInt(idx, 10) - 1];
    actualParams.push(val ?? null);
    return "?";
  });
  const rows = db.prepare(sql).all(...actualParams);
  return rows.map(r => {
    const o: any = { ...r };
    for (const k of JSON_COLS) if (typeof o[k] === "string") try { o[k] = JSON.parse(o[k]); } catch { /* plain text */ }
    return o;
  });
}

export async function tx<T>(fn: () => Promise<T>): Promise<T> {
  await q("begin");
  try { const r = await fn(); await q("commit"); return r; } catch (e) { await q("rollback"); throw e; }
}

export const placeholders = (n: number, from = 1) => Array.from({ length: n }, (_, i) => `$${from + i}`).join(",");

// shortcut: schema bootstrapped with IF NOT EXISTS, no migration tool; adopt one when the schema starts changing
const ID = "text primary key default (lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(2)))||'-4'||substr(lower(hex(randomblob(2))),2)||'-'||substr('89ab',abs(random())%4+1,1)||substr(lower(hex(randomblob(2))),2)||'-'||lower(hex(randomblob(6))))";
const NOW = "text default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))";
const SCHEMA = `
create table if not exists investigations (
  id ${ID}, owner_id text, title text not null, root_subject text not null,
  version int not null default 0, created_at ${NOW}, updated_at ${NOW},
  watch_hours int not null default 0, watch_webhook text, last_watch_at text);
create table if not exists graph_nodes (
  id ${ID}, investigation_id text not null references investigations(id) on delete cascade,
  canonical_key text not null, type text not null, label text not null, properties text default '{}',
  version int not null default 0, created_at ${NOW},
  unique (investigation_id, canonical_key, type));
create table if not exists claims (
  id ${ID}, investigation_id text not null references investigations(id) on delete cascade,
  subject_node_id text not null references graph_nodes(id), predicate text not null,
  object_node_id text references graph_nodes(id), value text, valid_from text, valid_to text,
  verification_status text not null);
create table if not exists graph_edges (
  id ${ID}, investigation_id text not null references investigations(id) on delete cascade,
  from_node_id text not null references graph_nodes(id), to_node_id text not null references graph_nodes(id),
  relation text not null, status text not null, claim_id text references claims(id), properties text default '{}',
  version int not null default 0, unique (investigation_id, from_node_id, to_node_id, relation));
create table if not exists sources (
  id ${ID}, canonical_url text not null unique, title text, publisher text,
  published_at text, retrieved_at ${NOW}, content_hash text, snapshot_text text,
  retrieval_status text not null);
create table if not exists claim_evidence (
  id ${ID}, claim_id text not null references claims(id) on delete cascade,
  source_id text not null references sources(id), excerpt text not null, start_offset int, end_offset int,
  support_verdict text not null, verification_metadata text default '{}',
  unique (claim_id, source_id, start_offset));
create table if not exists expansion_jobs (
  id ${ID}, investigation_id text not null references investigations(id) on delete cascade,
  parent_id text references expansion_jobs(id), idempotency_key text, target_type text not null, target_id text not null,
  question text not null, status text not null, stage text, budget text not null, usage text default '{}',
  cancel_requested int not null default 0, created_at ${NOW},
  started_at text, finished_at text, error text,
  unique (investigation_id, idempotency_key));
create index if not exists expansion_jobs_inv_status on expansion_jobs (investigation_id, status);
create table if not exists expansion_events (
  id integer primary key autoincrement, job_id text not null references expansion_jobs(id) on delete cascade,
  sequence_number int not null, event_type text not null, payload text default '{}', created_at ${NOW},
  unique (job_id, sequence_number));
create table if not exists job_discoveries (
  job_id text not null references expansion_jobs(id) on delete cascade, node_id text, edge_id text, claim_id text,
  discovery_status text not null default 'committed');
create table if not exists review_items (
  id ${ID}, investigation_id text not null references investigations(id) on delete cascade, job_id text not null,
  subject text not null, subject_type text, predicate text not null, object text not null, object_type text,
  valid_from text, valid_to text, source_id text not null references sources(id), start_offset int, end_offset int,
  excerpt text, source_kind text, status text not null default 'pending', created_at ${NOW});
create table if not exists claim_conflicts (
  id ${ID}, claim_a_id text not null references claims(id), claim_b_id text not null references claims(id),
  reason text, resolution_status text not null default 'unresolved', unique (claim_a_id, claim_b_id));
`;
