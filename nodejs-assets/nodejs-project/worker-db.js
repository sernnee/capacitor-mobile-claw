/**
 * worker-db.js — SQLite persistence layer for mobile-claw Node.js worker.
 *
 * Uses sql.js (WASM SQLite) for ACID transactions, crash-safe writes,
 * and structured queries. Replaces raw JSONL/JSON file persistence.
 *
 * Architecture:
 * - sql.js operates in-memory; we persist to disk via atomic tmp+rename
 * - flush() exports the full DB and writes atomically (survives OOM kill)
 * - Auto-flush every 5s to limit data loss window
 * - On init, loads existing DB file or creates fresh
 */

import { createRequire } from 'node:module';
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
  renameSync,
  mkdirSync,
  openSync,
  writeSync,
  fsyncSync,
  closeSync,
  unlinkSync,
} from 'node:fs';
import { join, dirname } from 'node:path';

// sql.js uses require-style exports; ESM import needs createRequire
const _require = createRequire(import.meta.url);

let db = null;
let dbPath = null;
let flushTimer = null;
let _ready = false;

const FLUSH_INTERVAL_MS = 5000;
const FLUSH_MAX_RETRIES = 3;
const SCHEMA_VERSION = 1;

// ── Schema ──────────────────────────────────────────────────────────────

const SCHEMA_SQL = `
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
`;

// ── Atomic file write helper ────────────────────────────────────────────

export function atomicWrite(filePath, data) {
  const tmpPath = filePath + '.tmp';
  const fd = openSync(tmpPath, 'w');
  try {
    if (typeof data === 'string') {
      writeSync(fd, data);
    } else {
      // Buffer / Uint8Array
      writeSync(fd, data, 0, data.length);
    }
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmpPath, filePath);
}

// ── Public API ──────────────────────────────────────────────────────────

/**
 * Initialize the SQLite database.
 * @param {string} openclawRoot - Root data directory ($OPENCLAW_ROOT)
 */
export async function initWorkerDb(openclawRoot) {
  if (_ready) return;

  dbPath = join(openclawRoot, 'mobile-claw.db');
  mkdirSync(openclawRoot, { recursive: true });

  // Load sql.js — skip entirely if WebAssembly is unavailable (Capacitor-NodeJS v18)
  // sql.js's WASM and asm.js builds both use Emscripten which references WebAssembly
  // globals at load time, so we can't even require() it without a real WASM runtime.
  // The caller (main.js) falls back to JSONL persistence when initWorkerDb throws.
  if (typeof WebAssembly === 'undefined' || globalThis.WebAssembly?._isStub) {
    throw new Error('WebAssembly is not available — using JSONL fallback');
  }

  let SQL;
  try {
    const initSqlJs = _require('sql.js');
    const wasmPath = join(
      dirname(_require.resolve('sql.js')),
      'sql-wasm.wasm'
    );
    SQL = await initSqlJs({
      locateFile: () => wasmPath,
    });
  } catch (wasmErr) {
    console.warn(`[worker-db] WASM init failed (${wasmErr.message}), trying asm.js fallback`);
    try {
      const initSqlJsAsm = _require('sql.js/dist/sql-asm.js');
      SQL = await initSqlJsAsm();
    } catch (asmErr) {
      console.error(`[worker-db] Both WASM and asm.js failed:`, asmErr.message);
      throw asmErr;
    }
  }

  // Open existing DB or create new
  if (existsSync(dbPath)) {
    try {
      const fileBuffer = readFileSync(dbPath);
      db = new SQL.Database(fileBuffer);
      console.log(`[worker-db] Loaded existing DB (${fileBuffer.length} bytes)`);
    } catch (err) {
      console.warn(`[worker-db] DB file corrupt (${err.message}), creating fresh`);
      db = new SQL.Database();
    }
  } else {
    db = new SQL.Database();
    console.log(`[worker-db] Created new DB`);
  }

  // Clean up stale tmp file if it exists (crash during previous flush)
  const tmpPath = dbPath + '.tmp';
  if (existsSync(tmpPath)) {
    try { unlinkSync(tmpPath); } catch { /* ignore */ }
  }

  // Run schema
  db.run(SCHEMA_SQL);

  // Check and apply migrations
  _migrate();

  // Evict old sessions and trim oversized ones
  _evictOldSessions();

  // Start auto-flush timer
  flushTimer = setInterval(() => {
    try { flush(); } catch (err) {
      console.warn(`[worker-db] Auto-flush failed: ${err.message}`);
    }
  }, FLUSH_INTERVAL_MS);

  _ready = true;
  console.log(`[worker-db] SQLite initialized (v${SCHEMA_VERSION})`);
}

/**
 * Check if the DB is ready for use.
 */
export function isDbReady() {
  return _ready && db !== null;
}

/**
 * Execute a SQL statement (INSERT, UPDATE, DELETE, CREATE).
 * @param {string} sql
 * @param {any[]} [params]
 */
export function run(sql, params) {
  if (!db) throw new Error('[worker-db] DB not initialized');
  db.run(sql, params);
}

/**
 * Query rows from the database.
 * @param {string} sql
 * @param {any[]} [params]
 * @returns {Object[]} Array of row objects
 */
export function query(sql, params) {
  if (!db) throw new Error('[worker-db] DB not initialized');
  const stmt = db.prepare(sql);
  if (params) stmt.bind(params);

  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

/**
 * Query a single row.
 * @param {string} sql
 * @param {any[]} [params]
 * @returns {Object|null}
 */
export function queryOne(sql, params) {
  const rows = query(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

/**
 * Run multiple statements inside a transaction.
 * Rolls back on error. Returns the result of the callback.
 * @param {Function} fn - Callback that calls run()/query()
 * @returns {*} Result of fn()
 */
export function transaction(fn) {
  if (!db) throw new Error('[worker-db] DB not initialized');
  db.run('BEGIN TRANSACTION');
  try {
    const result = fn();
    db.run('COMMIT');
    return result;
  } catch (err) {
    db.run('ROLLBACK');
    throw err;
  }
}

/**
 * Persist the in-memory database to disk atomically.
 * Uses tmp+rename+fsync pattern for crash safety.
 */
export function flush() {
  if (!db || !dbPath) return;

  const data = db.export();
  const buffer = Buffer.from(data);

  let lastErr;
  for (let attempt = 0; attempt < FLUSH_MAX_RETRIES; attempt++) {
    try {
      atomicWrite(dbPath, buffer);
      return;
    } catch (err) {
      lastErr = err;
      if (attempt < FLUSH_MAX_RETRIES - 1) {
        // Brief sync delay before retry
        const start = Date.now();
        while (Date.now() - start < 100) { /* spin wait — no setTimeout in sync context */ }
      }
    }
  }
  throw lastErr;
}

/**
 * Close the database and stop auto-flush.
 */
export function close() {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  if (db) {
    try { flush(); } catch { /* best effort */ }
    db.close();
    db = null;
  }
  _ready = false;
}

// ── Migration ───────────────────────────────────────────────────────────

function _migrate() {
  const row = queryOne('SELECT MAX(version) as v FROM schema_version');
  const currentVersion = row?.v || 0;

  if (currentVersion < 1) {
    // Schema already created above via SCHEMA_SQL
    run('INSERT OR REPLACE INTO schema_version (version) VALUES (?)', [1]);
    console.log(`[worker-db] Migrated to v1`);
  }

  // Future migrations go here:
  // if (currentVersion < 2) { ... run('ALTER TABLE ...'); ... }
}

// ── Session eviction + size management ──────────────────────────────────

const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const MAX_MESSAGES_PER_SESSION = 5000;

function _evictOldSessions() {
  try {
    const cutoff = Date.now() - SESSION_MAX_AGE_MS;

    // Delete messages for expired sessions
    const expired = query('SELECT session_key FROM sessions WHERE updated_at < ?', [cutoff]);
    if (expired.length > 0) {
      run('DELETE FROM messages WHERE session_key IN (SELECT session_key FROM sessions WHERE updated_at < ?)', [cutoff]);
      run('DELETE FROM sessions WHERE updated_at < ?', [cutoff]);
      console.log(`[worker-db] Evicted ${expired.length} sessions older than 30 days`);
    }

    // Trim oversized sessions (keep newest messages)
    const large = query(
      `SELECT session_key, COUNT(*) as cnt FROM messages
       GROUP BY session_key HAVING cnt > ?`,
      [MAX_MESSAGES_PER_SESSION]
    );
    for (const row of large) {
      const excess = row.cnt - MAX_MESSAGES_PER_SESSION;
      run(
        `DELETE FROM messages WHERE id IN (
           SELECT id FROM messages WHERE session_key = ?
           ORDER BY sequence ASC LIMIT ?
         )`,
        [row.session_key, excess]
      );
      console.log(`[worker-db] Trimmed ${excess} old messages from session ${row.session_key}`);
    }

    if (expired.length > 0 || large.length > 0) {
      flush();
    }
  } catch (err) {
    console.warn(`[worker-db] Eviction failed (non-fatal): ${err.message}`);
  }
}

// ── JSONL Migration (Phase 3) ───────────────────────────────────────────

/**
 * Import existing JSONL session files into SQLite.
 * Called once on first run after upgrade.
 * @param {string} openclawRoot
 * @param {string} agentId
 * @param {Function} deduplicateMessages - existing dedup function from main.js
 */
export function migrateFromJsonl(openclawRoot, agentId, deduplicateMessages) {
  // Check if migration already done
  const migrated = queryOne('SELECT value FROM config WHERE key = ?', ['jsonl_migration_done']);
  if (migrated) return;

  const sessionsDir = join(openclawRoot, 'agents', agentId, 'sessions');
  const sessionsJsonPath = join(sessionsDir, 'sessions.json');

  // Load session index
  let sessionIndex = {};
  try {
    const raw = JSON.parse(readFileSync(sessionsJsonPath, 'utf8'));
    sessionIndex = raw[agentId] || raw;
  } catch {
    // Rebuild from JSONL files
    sessionIndex = _rebuildIndexFromFiles(sessionsDir, agentId);
  }

  const sessionKeys = Object.keys(sessionIndex);
  if (sessionKeys.length === 0) {
    run('INSERT OR REPLACE INTO config (key, value, updated_at) VALUES (?, ?, ?)',
      ['jsonl_migration_done', '1', Date.now()]);
    flush();
    return;
  }

  console.log(`[worker-db] Migrating ${sessionKeys.length} sessions from JSONL...`);

  let totalMessages = 0;

  transaction(() => {
    for (const sessionKey of sessionKeys) {
      const meta = sessionIndex[sessionKey];
      const jsonlFile = join(sessionsDir, `${sessionKey.replace('/', '_')}.jsonl`);

      // Insert session metadata
      run(
        `INSERT OR REPLACE INTO sessions
         (session_key, agent_id, created_at, updated_at, model, total_tokens)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          sessionKey,
          agentId,
          meta.createdAt || Date.now(),
          meta.updatedAt || Date.now(),
          meta.model || 'anthropic/claude-sonnet-4-5',
          meta.totalTokens || 0,
        ]
      );

      // Import messages from JSONL
      if (!existsSync(jsonlFile)) continue;

      try {
        const raw = readFileSync(jsonlFile, 'utf8');
        const lines = raw.split('\n').filter(l => l.trim());
        const parsed = [];
        for (const line of lines) {
          try { parsed.push(JSON.parse(line)); }
          catch { /* skip corrupted lines */ }
        }
        const messages = deduplicateMessages(parsed);

        for (let i = 0; i < messages.length; i++) {
          const m = messages[i];
          run(
            `INSERT OR IGNORE INTO messages
             (session_key, sequence, role, content, timestamp, model, tool_call_id, usage_input, usage_output)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              sessionKey,
              i,
              m.role,
              typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
              m.timestamp || null,
              m.model || null,
              m.toolCallId || null,
              m.usage?.input || null,
              m.usage?.output || null,
            ]
          );
          totalMessages++;
        }
      } catch (err) {
        console.warn(`[worker-db] Failed to migrate session ${sessionKey}: ${err.message}`);
      }
    }

    run('INSERT OR REPLACE INTO config (key, value, updated_at) VALUES (?, ?, ?)',
      ['jsonl_migration_done', '1', Date.now()]);
  });

  flush();
  console.log(`[worker-db] Migration complete: ${sessionKeys.length} sessions, ${totalMessages} messages`);
}

function _rebuildIndexFromFiles(sessionsDir) {
  const index = {};
  try {
    const files = readdirSync(sessionsDir).filter(f => f.endsWith('.jsonl'));
    for (const file of files) {
      const sessionKey = file.replace('.jsonl', '').replace('_', '/');
      const stat = statSync(join(sessionsDir, file));
      index[sessionKey] = {
        sessionId: sessionKey,
        createdAt: stat.birthtimeMs || stat.ctimeMs,
        updatedAt: stat.mtimeMs,
        model: 'anthropic/claude-sonnet-4-5',
        totalTokens: 0,
      };
    }
  } catch { /* empty index */ }
  return index;
}
