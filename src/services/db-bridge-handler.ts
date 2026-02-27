/**
 * db-bridge-handler.ts — WebView-side handler for worker DB requests.
 *
 * Listens for JSON-RPC 2.0 `db.jsonrpc` messages from the Node.js worker
 * and executes them against native SQLite via @capacitor-community/sqlite.
 *
 * This replaces the WASM SQLite (sql.js) that previously ran inside the
 * worker, enabling native SQLite on all platforms including iOS where
 * WebAssembly is unavailable in Capacitor-NodeJS.
 *
 * Message format:
 *   Worker → WebView: { type: 'db.jsonrpc', payload: { jsonrpc:'2.0', id, method, params } }
 *   WebView → Worker: { type: 'db.jsonrpc.response', payload: { jsonrpc:'2.0', id, result/error } }
 */

import { Capacitor } from '@capacitor/core'
import { CapacitorSQLite, SQLiteConnection } from '@capacitor-community/sqlite'

const DB_NAME = 'mobile-claw'
const DB_VERSION = 2

// ── Schema (matches worker-db.js exactly) ──────────────────────────────

const SCHEMA_V1 = `
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS sessions (
  session_key TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL DEFAULT 'main',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  model TEXT,
  total_tokens INTEGER DEFAULT 0,
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_key TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  timestamp INTEGER,
  model TEXT,
  tool_call_id TEXT,
  usage_input INTEGER,
  usage_output INTEGER,
  UNIQUE(session_key, sequence)
);

CREATE INDEX IF NOT EXISTS idx_messages_session
  ON messages(session_key, sequence);

CREATE TABLE IF NOT EXISTS config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER
);
`

const SCHEMA_V2 = `
CREATE TABLE IF NOT EXISTS cron_skills (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  allowed_tools TEXT,
  system_prompt TEXT,
  model TEXT,
  max_turns INTEGER DEFAULT 3,
  timeout_ms INTEGER DEFAULT 60000,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS cron_jobs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  session_target TEXT NOT NULL DEFAULT 'isolated',
  wake_mode TEXT DEFAULT 'next-heartbeat',
  schedule_kind TEXT NOT NULL,
  schedule_every_ms INTEGER,
  schedule_anchor_ms INTEGER,
  schedule_at_ms INTEGER,
  skill_id TEXT NOT NULL,
  prompt TEXT NOT NULL,
  delivery_mode TEXT NOT NULL DEFAULT 'notification',
  delivery_webhook_url TEXT,
  delivery_notification_title TEXT,
  active_hours_start TEXT,
  active_hours_end TEXT,
  active_hours_tz TEXT,
  last_run_at INTEGER,
  next_run_at INTEGER,
  last_run_status TEXT,
  last_error TEXT,
  last_duration_ms INTEGER,
  last_response_hash TEXT,
  last_response_sent_at INTEGER,
  consecutive_errors INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cron_jobs_next_run_at ON cron_jobs(enabled, next_run_at);

CREATE TABLE IF NOT EXISTS cron_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  status TEXT,
  duration_ms INTEGER,
  error TEXT,
  response_text TEXT,
  was_heartbeat_ok INTEGER DEFAULT 0,
  was_deduped INTEGER DEFAULT 0,
  delivered INTEGER DEFAULT 0,
  wake_source TEXT
);
CREATE INDEX IF NOT EXISTS idx_cron_runs_job_started ON cron_runs(job_id, started_at DESC);

CREATE TABLE IF NOT EXISTS heartbeat_config (
  id INTEGER PRIMARY KEY DEFAULT 1,
  enabled INTEGER NOT NULL DEFAULT 0,
  every_ms INTEGER NOT NULL DEFAULT 1800000,
  prompt TEXT,
  skill_id TEXT,
  active_hours_start TEXT,
  active_hours_end TEXT,
  active_hours_tz TEXT,
  next_run_at INTEGER,
  last_heartbeat_hash TEXT,
  last_heartbeat_sent_at INTEGER,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS scheduler_config (
  id INTEGER PRIMARY KEY DEFAULT 1,
  enabled INTEGER NOT NULL DEFAULT 1,
  scheduling_mode TEXT NOT NULL DEFAULT 'balanced',
  run_on_charging INTEGER NOT NULL DEFAULT 1,
  global_active_hours_start TEXT,
  global_active_hours_end TEXT,
  global_active_hours_tz TEXT,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS system_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_key TEXT NOT NULL,
  context_key TEXT,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  consumed INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_system_events_pending ON system_events(session_key, consumed, created_at);
`

const MIGRATIONS = [
  { version: 1, sql: SCHEMA_V1 },
  { version: 2, sql: SCHEMA_V2 },
]

// Seed rows for singleton config tables (matches worker-db.js _migrate())
const SEED_SQL = `
INSERT OR IGNORE INTO heartbeat_config
  (id, enabled, every_ms, updated_at)
  VALUES (1, 0, 1800000, 0);

INSERT OR IGNORE INTO scheduler_config
  (id, enabled, scheduling_mode, run_on_charging, updated_at)
  VALUES (1, 1, 'balanced', 1, 0);

INSERT OR REPLACE INTO schema_version (version) VALUES (2);
`

export class DbBridgeHandler {
  private sqlite: SQLiteConnection | null = null
  private db: any = null
  private nodePlugin: any
  private isWeb = false
  private initPromise: Promise<void> | null = null

  constructor(nodePlugin: any) {
    this.nodePlugin = nodePlugin
  }

  /**
   * Start listening for DB requests from the worker.
   * Must be called before the worker sends any db.jsonrpc messages.
   */
  start(): void {
    this.nodePlugin.addListener('message', (event: any) => {
      const msg = event?.args?.[0] ?? event
      if (!msg || msg.type !== 'db.jsonrpc') return
      this._handleRequest(msg.payload)
    })
  }

  private async _handleRequest(req: any): Promise<void> {
    const { id, method, params } = req
    try {
      let result: any
      switch (method) {
        case 'db.init':
          result = await this._initDb()
          break
        case 'db.isReady':
          result = { ready: this.db !== null }
          break
        case 'db.run':
          result = await this._run(params)
          break
        case 'db.query':
          result = await this._query(params)
          break
        case 'db.queryOne':
          result = await this._queryOne(params)
          break
        case 'db.transaction':
          result = await this._transaction(params)
          break
        case 'db.flush':
          result = {}
          break
        default:
          throw new Error(`Unknown DB method: ${method}`)
      }
      this._respond(id, result)
    } catch (err: any) {
      console.error(`[db-bridge] RPC error: method=${method} id=${id} err=${err?.message}`)
      this._respondError(id, err)
    }
  }

  private _respond(id: number, result: any): void {
    this.nodePlugin
      .send({
        eventName: 'message',
        args: [
          {
            type: 'db.jsonrpc.response',
            payload: { jsonrpc: '2.0', id, result },
          },
        ],
      })
      .catch((err: any) => {
        console.error(`[db-bridge] Failed to send response for id=${id}:`, err)
      })
  }

  private _respondError(id: number, err: any): void {
    this.nodePlugin
      .send({
        eventName: 'message',
        args: [
          {
            type: 'db.jsonrpc.response',
            payload: {
              jsonrpc: '2.0',
              id,
              error: { code: -1, message: err?.message || String(err) },
            },
          },
        ],
      })
      .catch((sendErr: any) => {
        console.error(`[db-bridge] Failed to send error for id=${id}:`, sendErr)
      })
  }

  // ── DB Initialization ──────────────────────────────────────────────────

  private async _initDb(): Promise<{ ready: true }> {
    // Idempotent — safe to call multiple times
    if (this.db) return { ready: true }
    if (this.initPromise) {
      await this.initPromise
      return { ready: true }
    }

    this.initPromise = this._doInit()
    await this.initPromise
    return { ready: true }
  }

  private async _doInit(): Promise<void> {
    this.isWeb = Capacitor.getPlatform() === 'web'
    this.sqlite = new SQLiteConnection(CapacitorSQLite)

    // Web requires jeep-sqlite custom element
    if (this.isWeb) {
      if (!document.querySelector('jeep-sqlite')) {
        const el = document.createElement('jeep-sqlite')
        document.body.appendChild(el)
      }
      await customElements.whenDefined('jeep-sqlite')
      await this.sqlite.initWebStore()
    }

    await this.sqlite.checkConnectionsConsistency()

    const isConn = await this.sqlite.isConnection(DB_NAME, false)
    if (isConn.result) {
      this.db = await this.sqlite.retrieveConnection(DB_NAME, false)
    } else {
      this.db = await this.sqlite.createConnection(DB_NAME, false, 'no-encryption', DB_VERSION, false)
    }

    await this.db.open()
    await this._runMigrations()

    // DB ready
  }

  private async _runMigrations(): Promise<void> {
    const vRes = await this.db.getVersion()
    const current = vRes.version || 0

    for (const m of MIGRATIONS) {
      if (m.version > current) {
        await this.db.execute(m.sql, false)
        console.log(`[db-bridge] Migrated to v${m.version}`)
      }
    }

    // Seed singleton config rows
    if (current < 2) {
      await this.db.execute(SEED_SQL, false)
    }
  }

  // ── DB Operations ──────────────────────────────────────────────────────

  private async _run(params: { sql: string; params?: any[] }): Promise<{ changes: number; lastId: number }> {
    const result = await this.db.run(params.sql, params.params || [], true)
    if (this.isWeb && this.sqlite) await this.sqlite.saveToStore(DB_NAME)
    return {
      changes: result.changes?.changes || 0,
      lastId: result.changes?.lastId || 0,
    }
  }

  private async _query(params: { sql: string; params?: any[] }): Promise<{ rows: any[] }> {
    const result = await this.db.query(params.sql, params.params || [])
    return { rows: result.values || [] }
  }

  private async _queryOne(params: { sql: string; params?: any[] }): Promise<{ row: any | null }> {
    const result = await this.db.query(params.sql, params.params || [])
    const rows = result.values || []
    return { row: rows.length > 0 ? rows[0] : null }
  }

  private async _transaction(params: {
    statements: Array<{ sql: string; params?: any[] }>
  }): Promise<{ results: any[] }> {
    const set = params.statements.map((s) => ({
      statement: s.sql,
      values: s.params || [],
    }))

    if (set.length === 0) return { results: [] }

    const result = await this.db.executeSet(set, true)
    if (this.isWeb && this.sqlite) await this.sqlite.saveToStore(DB_NAME)
    return { results: result.changes ? [result.changes] : [] }
  }
}
