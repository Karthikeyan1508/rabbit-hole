import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';

// Known columns stored as JSON text across the schema
const JSON_COLUMNS = new Set([
  'properties',
  'value',
  'verification_metadata',
  'budget',
  'usage',
  'payload',
  'details',
]);

let dbInstance: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (dbInstance) {
    return dbInstance;
  }

  const dbPath = process.env.DATABASE_PATH
    ? path.resolve(process.cwd(), process.env.DATABASE_PATH)
    : path.resolve(process.cwd(), 'rabbithole.db');

  dbInstance = new DatabaseSync(dbPath);

  // Configure SQLite connection
  dbInstance.exec('PRAGMA journal_mode = WAL;');
  dbInstance.exec('PRAGMA foreign_keys = ON;');
  dbInstance.exec('PRAGMA busy_timeout = 5000;');

  initSchema(dbInstance);

  return dbInstance;
}

function initSchema(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS investigations (
      id TEXT PRIMARY KEY,
      owner_id TEXT,
      title TEXT NOT NULL,
      root_subject TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      watch_hours INTEGER DEFAULT 24,
      watch_webhook TEXT,
      last_watch_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS graph_nodes (
      id TEXT PRIMARY KEY,
      investigation_id TEXT NOT NULL,
      canonical_key TEXT NOT NULL,
      type TEXT NOT NULL,
      label TEXT NOT NULL,
      properties TEXT DEFAULT '{}',
      version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      FOREIGN KEY (investigation_id) REFERENCES investigations(id) ON DELETE CASCADE,
      UNIQUE (investigation_id, canonical_key, type)
    );

    CREATE TABLE IF NOT EXISTS claims (
      id TEXT PRIMARY KEY,
      investigation_id TEXT NOT NULL,
      subject_node_id TEXT NOT NULL,
      predicate TEXT NOT NULL,
      object_node_id TEXT,
      value TEXT,
      valid_from TEXT,
      valid_to TEXT,
      verification_status TEXT NOT NULL DEFAULT 'unverified',
      FOREIGN KEY (investigation_id) REFERENCES investigations(id) ON DELETE CASCADE,
      FOREIGN KEY (subject_node_id) REFERENCES graph_nodes(id) ON DELETE CASCADE,
      FOREIGN KEY (object_node_id) REFERENCES graph_nodes(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS graph_edges (
      id TEXT PRIMARY KEY,
      investigation_id TEXT NOT NULL,
      from_node_id TEXT NOT NULL,
      to_node_id TEXT NOT NULL,
      relation TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      claim_id TEXT,
      properties TEXT DEFAULT '{}',
      version INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY (investigation_id) REFERENCES investigations(id) ON DELETE CASCADE,
      FOREIGN KEY (from_node_id) REFERENCES graph_nodes(id) ON DELETE CASCADE,
      FOREIGN KEY (to_node_id) REFERENCES graph_nodes(id) ON DELETE CASCADE,
      FOREIGN KEY (claim_id) REFERENCES claims(id) ON DELETE SET NULL,
      UNIQUE (investigation_id, from_node_id, to_node_id, relation)
    );

    CREATE TABLE IF NOT EXISTS sources (
      id TEXT PRIMARY KEY,
      canonical_url TEXT NOT NULL UNIQUE,
      title TEXT,
      publisher TEXT,
      published_at TEXT,
      retrieved_at TEXT NOT NULL,
      content_hash TEXT,
      snapshot_text TEXT,
      retrieval_status TEXT NOT NULL DEFAULT 'pending'
    );

    CREATE TABLE IF NOT EXISTS claim_evidence (
      id TEXT PRIMARY KEY,
      claim_id TEXT NOT NULL,
      source_id TEXT NOT NULL,
      excerpt TEXT NOT NULL,
      start_offset INTEGER,
      end_offset INTEGER,
      support_verdict TEXT NOT NULL,
      verification_metadata TEXT DEFAULT '{}',
      FOREIGN KEY (claim_id) REFERENCES claims(id) ON DELETE CASCADE,
      FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS expansion_jobs (
      id TEXT PRIMARY KEY,
      investigation_id TEXT NOT NULL,
      parent_id TEXT,
      idempotency_key TEXT,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      question TEXT,
      status TEXT NOT NULL DEFAULT 'queued',
      stage TEXT NOT NULL DEFAULT 'init',
      budget TEXT DEFAULT '{}',
      usage TEXT DEFAULT '{}',
      cancel_requested INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      error TEXT,
      FOREIGN KEY (investigation_id) REFERENCES investigations(id) ON DELETE CASCADE,
      FOREIGN KEY (parent_id) REFERENCES expansion_jobs(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS expansion_events (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      sequence_number INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      payload TEXT DEFAULT '{}',
      created_at TEXT NOT NULL,
      FOREIGN KEY (job_id) REFERENCES expansion_jobs(id) ON DELETE CASCADE,
      UNIQUE (job_id, sequence_number)
    );

    CREATE TABLE IF NOT EXISTS job_discoveries (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      discovery_data TEXT DEFAULT '{}',
      created_at TEXT NOT NULL,
      FOREIGN KEY (job_id) REFERENCES expansion_jobs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS review_items (
      id TEXT PRIMARY KEY,
      investigation_id TEXT NOT NULL,
      item_type TEXT NOT NULL,
      item_id TEXT NOT NULL,
      action_needed TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL,
      FOREIGN KEY (investigation_id) REFERENCES investigations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS claim_conflicts (
      id TEXT PRIMARY KEY,
      investigation_id TEXT NOT NULL,
      claim_a_id TEXT NOT NULL,
      claim_b_id TEXT NOT NULL,
      conflict_description TEXT,
      status TEXT NOT NULL DEFAULT 'unresolved',
      created_at TEXT NOT NULL,
      FOREIGN KEY (investigation_id) REFERENCES investigations(id) ON DELETE CASCADE,
      FOREIGN KEY (claim_a_id) REFERENCES claims(id) ON DELETE CASCADE,
      FOREIGN KEY (claim_b_id) REFERENCES claims(id) ON DELETE CASCADE
    );
  `);
}

/**
 * Translates Postgres-style $1, $2 query placeholders to SQLite ? parameters,
 * and handles automatic JSON parsing for known columns.
 */
export function translatePostgresParams(sql: string, params: any[]): { sqliteSql: string; orderedParams: any[] } {
  // Check if $1, $2, etc. exist
  const hasNumberedParams = /\$\d+/.test(sql);

  if (!hasNumberedParams) {
    return { sqliteSql: sql, orderedParams: params };
  }

  const orderedParams: any[] = [];
  const sqliteSql = sql.replace(/\$(\d+)/g, (_, numStr) => {
    const idx = parseInt(numStr, 10) - 1;
    orderedParams.push(params[idx]);
    return '?';
  });

  return { sqliteSql, orderedParams };
}

function parseRow(row: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(row)) {
    if (JSON_COLUMNS.has(key) && typeof value === 'string') {
      try {
        result[key] = JSON.parse(value);
      } catch {
        result[key] = value;
      }
    } else {
      result[key] = value;
    }
  }
  return result;
}

/**
 * q() helper: run a SQL query with Postgres-style $1 parameters and parse JSON columns
 */
export function q<T = any>(sql: string, ...params: any[]): T[] {
  const db = getDb();
  const { sqliteSql, orderedParams } = translatePostgresParams(sql, params);
  const stmt = db.prepare(sqliteSql);
  const rows = stmt.all(...orderedParams) as Record<string, any>[];
  return rows.map((r) => parseRow(r) as T);
}

/**
 * qOne() helper: return single result or null
 */
export function qOne<T = any>(sql: string, ...params: any[]): T | null {
  const rows = q<T>(sql, ...params);
  return rows.length > 0 ? rows[0] : null;
}

/**
 * qRun() helper: run an INSERT/UPDATE/DELETE query
 */
export function qRun(sql: string, ...params: any[]): { changes: number | bigint; lastInsertRowid: number | bigint } {
  const db = getDb();
  const { sqliteSql, orderedParams } = translatePostgresParams(sql, params);
  const stmt = db.prepare(sqliteSql);
  return stmt.run(...orderedParams);
}

/**
 * tx() helper: execute a callback inside a transaction
 */
export function tx<T>(fn: () => T): T {
  const db = getDb();
  db.exec('BEGIN IMMEDIATE;');
  try {
    const result = fn();
    db.exec('COMMIT;');
    return result;
  } catch (err) {
    db.exec('ROLLBACK;');
    throw err;
  }
}
