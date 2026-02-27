/**
 * worker-db.js — SQLite persistence layer for mobile-claw Node.js worker.
 *
 * Delegates all database operations to native SQLite via a JSON-RPC bridge
 * to the WebView (db-bridge-handler.ts). This replaces the previous sql.js
 * (WASM SQLite) approach, enabling native SQLite on all platforms including
 * iOS where WebAssembly is unavailable in Capacitor-NodeJS.
 *
 * Architecture:
 * - Worker sends JSON-RPC requests via the Capacitor-NodeJS bridge channel
 * - WebView-side handler executes them on @capacitor-community/sqlite
 * - Native SQLite auto-persists — no flush/atomic-write needed
 * - All functions are async (bridge round-trip)
 */

import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  mkdirSync,
  openSync,
  writeSync,
  fsyncSync,
  closeSync,
  renameSync,
} from 'node:fs';
import { join } from 'node:path';
import { initDbBridge } from './db-bridge-client.js';

let bridge = null;
let _ready = false;

// ── Atomic file write helper (still used by main.js for non-DB writes) ──

export function atomicWrite(filePath, data) {
  const tmpPath = filePath + '.tmp';
  const fd = openSync(tmpPath, 'w');
  try {
    if (typeof data === 'string') {
      writeSync(fd, data);
    } else {
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
 * Initialize the SQLite database via native bridge.
 * @param {string} openclawRoot - Root data directory ($OPENCLAW_ROOT)
 * @param {object} channel - The Capacitor-NodeJS bridge channel
 */
export async function initWorkerDb(openclawRoot, channel) {
  if (_ready) return;

  mkdirSync(openclawRoot, { recursive: true });

  bridge = initDbBridge(channel);
  await bridge.init();
  _ready = true;

  // Evict old sessions (non-blocking)
  _evictOldSessions().catch(err => {
    console.warn(`[worker-db] Eviction failed (non-fatal): ${err.message}`);
  });

  console.log('[worker-db] Native SQLite bridge initialized');
}

/**
 * Check if the DB is ready for use.
 * @returns {boolean}
 */
export function isDbReady() {
  return _ready && bridge !== null;
}

/**
 * Execute a SQL statement (INSERT, UPDATE, DELETE, CREATE).
 * @param {string} sql
 * @param {any[]} [params]
 * @returns {Promise<{ changes: number, lastId: number }>}
 */
export async function run(sql, params) {
  if (!bridge) throw new Error('[worker-db] DB not initialized');
  return bridge.run(sql, params);
}

/**
 * Query rows from the database.
 * @param {string} sql
 * @param {any[]} [params]
 * @returns {Promise<Object[]>} Array of row objects
 */
export async function query(sql, params) {
  if (!bridge) throw new Error('[worker-db] DB not initialized');
  return bridge.query(sql, params);
}

/**
 * Query a single row.
 * @param {string} sql
 * @param {any[]} [params]
 * @returns {Promise<Object|null>}
 */
export async function queryOne(sql, params) {
  if (!bridge) throw new Error('[worker-db] DB not initialized');
  return bridge.queryOne(sql, params);
}

/**
 * Run multiple statements inside an atomic transaction.
 * @param {Array<{sql: string, params?: any[]}>} statements
 * @returns {Promise<{ results: any[] }>}
 */
export async function transaction(statements) {
  if (!bridge) throw new Error('[worker-db] DB not initialized');
  return bridge.transaction(statements);
}

/**
 * No-op — native SQLite auto-persists.
 * Kept for API compatibility.
 */
export async function flush() {
  // no-op
}

/**
 * Close the database bridge.
 */
export function close() {
  if (bridge) {
    bridge.destroy();
    bridge = null;
  }
  _ready = false;
}

// ── Session eviction + size management ──────────────────────────────────

const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const MAX_MESSAGES_PER_SESSION = 5000;

async function _evictOldSessions() {
  const cutoff = Date.now() - SESSION_MAX_AGE_MS;

  const expired = await query('SELECT session_key FROM sessions WHERE updated_at < ?', [cutoff]);
  if (expired.length > 0) {
    await run('DELETE FROM messages WHERE session_key IN (SELECT session_key FROM sessions WHERE updated_at < ?)', [cutoff]);
    await run('DELETE FROM sessions WHERE updated_at < ?', [cutoff]);
    console.log(`[worker-db] Evicted ${expired.length} sessions older than 30 days`);
  }

  const large = await query(
    `SELECT session_key, COUNT(*) as cnt FROM messages
     GROUP BY session_key HAVING cnt > ?`,
    [MAX_MESSAGES_PER_SESSION]
  );
  for (const row of large) {
    const excess = row.cnt - MAX_MESSAGES_PER_SESSION;
    await run(
      `DELETE FROM messages WHERE id IN (
         SELECT id FROM messages WHERE session_key = ?
         ORDER BY sequence ASC LIMIT ?
       )`,
      [row.session_key, excess]
    );
    console.log(`[worker-db] Trimmed ${excess} old messages from session ${row.session_key}`);
  }
}

// ── JSONL Migration (one-time, from legacy persistence) ─────────────────

/**
 * Import existing JSONL session files into native SQLite.
 * Called once on first run after upgrade from WASM/JSONL persistence.
 * @param {string} openclawRoot
 * @param {string} agentId
 */
export async function migrateFromJsonl(openclawRoot, agentId) {
  const migrated = await queryOne('SELECT value FROM config WHERE key = ?', ['jsonl_migration_done']);
  if (migrated) return;

  const sessionsDir = join(openclawRoot, 'agents', agentId, 'sessions');
  const sessionsJsonPath = join(sessionsDir, 'sessions.json');

  let sessionIndex = {};
  try {
    const raw = JSON.parse(readFileSync(sessionsJsonPath, 'utf8'));
    sessionIndex = raw[agentId] || raw;
  } catch {
    sessionIndex = _rebuildIndexFromFiles(sessionsDir);
  }

  const sessionKeys = Object.keys(sessionIndex);
  if (sessionKeys.length === 0) {
    await run('INSERT OR REPLACE INTO config (key, value, updated_at) VALUES (?, ?, ?)',
      ['jsonl_migration_done', '1', Date.now()]);
    return;
  }

  console.log(`[worker-db] Migrating ${sessionKeys.length} sessions from JSONL...`);

  let totalMessages = 0;
  const CHUNK_SIZE = 500;

  for (const sessionKey of sessionKeys) {
    const meta = sessionIndex[sessionKey];
    const jsonlFile = join(sessionsDir, `${sessionKey.replace('/', '_')}.jsonl`);

    const statements = [];

    statements.push({
      sql: `INSERT OR REPLACE INTO sessions
         (session_key, agent_id, created_at, updated_at, model, total_tokens)
         VALUES (?, ?, ?, ?, ?, ?)`,
      params: [
        sessionKey,
        agentId,
        meta.createdAt || Date.now(),
        meta.updatedAt || Date.now(),
        meta.model || 'anthropic/claude-sonnet-4-5',
        meta.totalTokens || 0,
      ],
    });

    if (existsSync(jsonlFile)) {
      try {
        const raw = readFileSync(jsonlFile, 'utf8');
        const lines = raw.split('\n').filter(l => l.trim());
        const parsed = [];
        for (const line of lines) {
          try { parsed.push(JSON.parse(line)); }
          catch { /* skip corrupted lines */ }
        }
        const messages = _deduplicateMessages(parsed);

        for (let i = 0; i < messages.length; i++) {
          const m = messages[i];
          statements.push({
            sql: `INSERT OR IGNORE INTO messages
               (session_key, sequence, role, content, timestamp, model, tool_call_id, usage_input, usage_output)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            params: [
              sessionKey,
              i,
              m.role,
              typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
              m.timestamp || null,
              m.model || null,
              m.toolCallId || null,
              m.usage?.input || null,
              m.usage?.output || null,
            ],
          });
          totalMessages++;
        }
      } catch (err) {
        console.warn(`[worker-db] Failed to migrate session ${sessionKey}: ${err.message}`);
      }
    }

    // Send in chunks to avoid oversized bridge messages
    for (let i = 0; i < statements.length; i += CHUNK_SIZE) {
      await transaction(statements.slice(i, i + CHUNK_SIZE));
    }
  }

  await run('INSERT OR REPLACE INTO config (key, value, updated_at) VALUES (?, ?, ?)',
    ['jsonl_migration_done', '1', Date.now()]);

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

/**
 * Remove duplicate messages (legacy JSONL bug).
 * Checks first 100 chars of content + role combination.
 */
function _deduplicateMessages(messages) {
  const seen = new Set();
  return messages.filter(m => {
    const contentStr = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
    const key = `${m.role}:${contentStr.slice(0, 100)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ── Cron/Scheduler/Heartbeat store ──────────────────────────────────────

function _toBool(value) {
  return Number(value) === 1;
}

function _toIntBool(value) {
  return value ? 1 : 0;
}

function _parseJsonArray(value) {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function _genId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function _mapActiveHours(start, end, tz) {
  if (!start && !end && !tz) return undefined;
  return {
    ...(start ? { start } : {}),
    ...(end ? { end } : {}),
    ...(tz ? { tz } : {}),
  };
}

function _toSchedulerConfig(row) {
  if (!row) return null;
  return {
    enabled: _toBool(row.enabled),
    schedulingMode: row.scheduling_mode || 'balanced',
    runOnCharging: _toBool(row.run_on_charging),
    globalActiveHours: _mapActiveHours(
      row.global_active_hours_start,
      row.global_active_hours_end,
      row.global_active_hours_tz
    ),
    updatedAt: row.updated_at,
  };
}

function _toHeartbeatConfig(row) {
  if (!row) return null;
  return {
    enabled: _toBool(row.enabled),
    everyMs: row.every_ms ?? 1800000,
    prompt: row.prompt || undefined,
    skillId: row.skill_id || undefined,
    activeHours: _mapActiveHours(row.active_hours_start, row.active_hours_end, row.active_hours_tz),
    nextRunAt: row.next_run_at ?? undefined,
    lastHash: row.last_heartbeat_hash || undefined,
    lastSentAt: row.last_heartbeat_sent_at ?? undefined,
    updatedAt: row.updated_at,
  };
}

function _toCronSkillRecord(row) {
  return {
    id: row.id,
    name: row.name,
    allowedTools: _parseJsonArray(row.allowed_tools),
    systemPrompt: row.system_prompt || undefined,
    model: row.model || undefined,
    maxTurns: row.max_turns ?? 3,
    timeoutMs: row.timeout_ms ?? 60000,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function _toCronJobRecord(row) {
  return {
    id: row.id,
    name: row.name,
    enabled: _toBool(row.enabled),
    sessionTarget: row.session_target || 'isolated',
    wakeMode: row.wake_mode || 'next-heartbeat',
    schedule: {
      kind: row.schedule_kind,
      everyMs: row.schedule_every_ms ?? undefined,
      anchorMs: row.schedule_anchor_ms ?? undefined,
      atMs: row.schedule_at_ms ?? undefined,
    },
    skillId: row.skill_id,
    prompt: row.prompt,
    deliveryMode: row.delivery_mode || 'notification',
    deliveryWebhookUrl: row.delivery_webhook_url || undefined,
    deliveryNotificationTitle: row.delivery_notification_title || undefined,
    activeHours: _mapActiveHours(row.active_hours_start, row.active_hours_end, row.active_hours_tz),
    lastRunAt: row.last_run_at ?? undefined,
    nextRunAt: row.next_run_at ?? undefined,
    lastRunStatus: row.last_run_status || undefined,
    lastError: row.last_error || undefined,
    lastDurationMs: row.last_duration_ms ?? undefined,
    lastResponseHash: row.last_response_hash || undefined,
    lastResponseSentAt: row.last_response_sent_at ?? undefined,
    consecutiveErrors: row.consecutive_errors ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function _toCronRunRecord(row) {
  return {
    id: row.id,
    jobId: row.job_id,
    startedAt: row.started_at,
    endedAt: row.ended_at ?? undefined,
    status: row.status,
    durationMs: row.duration_ms ?? undefined,
    error: row.error || undefined,
    responseText: row.response_text || undefined,
    wasHeartbeatOk: _toBool(row.was_heartbeat_ok || 0),
    wasDeduped: _toBool(row.was_deduped || 0),
    delivered: _toBool(row.delivered || 0),
    wakeSource: row.wake_source || undefined,
  };
}

async function _ensureSchedulerConfigRow() {
  const now = Date.now();
  await run(
    `INSERT OR IGNORE INTO scheduler_config
     (id, enabled, scheduling_mode, run_on_charging, updated_at)
     VALUES (1, 1, 'balanced', 1, ?)`,
    [now]
  );
}

async function _ensureHeartbeatConfigRow() {
  const now = Date.now();
  await run(
    `INSERT OR IGNORE INTO heartbeat_config
     (id, enabled, every_ms, updated_at)
     VALUES (1, 0, 1800000, ?)`,
    [now]
  );
}

function _resolveNextRunAt(schedule, now = Date.now()) {
  if (!schedule || !schedule.kind) return null;
  if (schedule.kind === 'at') return Number(schedule.atMs) || null;
  if (schedule.kind === 'every') {
    const everyMs = Number(schedule.everyMs) || 0;
    if (everyMs <= 0) return null;
    return now + everyMs;
  }
  return null;
}

export async function getSchedulerConfig() {
  await _ensureSchedulerConfigRow();
  const row = await queryOne('SELECT * FROM scheduler_config WHERE id = 1');
  return _toSchedulerConfig(row);
}

export async function setSchedulerConfig(patch = {}) {
  await _ensureSchedulerConfigRow();
  const sets = [];
  const params = [];

  if (patch.enabled !== undefined) {
    sets.push('enabled = ?');
    params.push(_toIntBool(!!patch.enabled));
  }
  if (patch.schedulingMode !== undefined || patch.scheduling_mode !== undefined) {
    sets.push('scheduling_mode = ?');
    params.push((patch.schedulingMode ?? patch.scheduling_mode) || 'balanced');
  }
  if (patch.runOnCharging !== undefined || patch.run_on_charging !== undefined) {
    sets.push('run_on_charging = ?');
    params.push(_toIntBool(!!(patch.runOnCharging ?? patch.run_on_charging)));
  }

  const globalActiveHours = patch.globalActiveHours || patch.global_active_hours;
  if (globalActiveHours) {
    sets.push('global_active_hours_start = ?');
    params.push(globalActiveHours.start || null);
    sets.push('global_active_hours_end = ?');
    params.push(globalActiveHours.end || null);
    sets.push('global_active_hours_tz = ?');
    params.push(globalActiveHours.tz || globalActiveHours.timezone || null);
  } else {
    if (patch.global_active_hours_start !== undefined) {
      sets.push('global_active_hours_start = ?');
      params.push(patch.global_active_hours_start || null);
    }
    if (patch.global_active_hours_end !== undefined) {
      sets.push('global_active_hours_end = ?');
      params.push(patch.global_active_hours_end || null);
    }
    if (patch.global_active_hours_tz !== undefined) {
      sets.push('global_active_hours_tz = ?');
      params.push(patch.global_active_hours_tz || null);
    }
  }

  sets.push('updated_at = ?');
  params.push(Date.now());
  params.push(1);

  await run(`UPDATE scheduler_config SET ${sets.join(', ')} WHERE id = ?`, params);
  return getSchedulerConfig();
}

export async function getHeartbeatConfig() {
  await _ensureHeartbeatConfigRow();
  const row = await queryOne('SELECT * FROM heartbeat_config WHERE id = 1');
  return _toHeartbeatConfig(row);
}

export async function setHeartbeatConfig(patch = {}) {
  await _ensureHeartbeatConfigRow();
  const sets = [];
  const params = [];

  if (patch.enabled !== undefined) {
    sets.push('enabled = ?');
    params.push(_toIntBool(!!patch.enabled));
  }
  if (patch.everyMs !== undefined || patch.every_ms !== undefined) {
    sets.push('every_ms = ?');
    params.push(Number(patch.everyMs ?? patch.every_ms) || 1800000);
  }
  if (patch.prompt !== undefined) {
    sets.push('prompt = ?');
    params.push(patch.prompt || null);
  }
  if (patch.skillId !== undefined || patch.skill_id !== undefined) {
    sets.push('skill_id = ?');
    params.push((patch.skillId ?? patch.skill_id) || null);
  }

  const activeHours = patch.activeHours || patch.active_hours;
  if (activeHours) {
    sets.push('active_hours_start = ?');
    params.push(activeHours.start || null);
    sets.push('active_hours_end = ?');
    params.push(activeHours.end || null);
    sets.push('active_hours_tz = ?');
    params.push(activeHours.tz || activeHours.timezone || null);
  } else {
    if (patch.active_hours_start !== undefined) {
      sets.push('active_hours_start = ?');
      params.push(patch.active_hours_start || null);
    }
    if (patch.active_hours_end !== undefined) {
      sets.push('active_hours_end = ?');
      params.push(patch.active_hours_end || null);
    }
    if (patch.active_hours_tz !== undefined) {
      sets.push('active_hours_tz = ?');
      params.push(patch.active_hours_tz || null);
    }
  }

  if (patch.nextRunAt !== undefined || patch.next_run_at !== undefined) {
    sets.push('next_run_at = ?');
    params.push(patch.nextRunAt ?? patch.next_run_at ?? null);
  }
  if (patch.lastHash !== undefined || patch.last_heartbeat_hash !== undefined) {
    sets.push('last_heartbeat_hash = ?');
    params.push((patch.lastHash ?? patch.last_heartbeat_hash) || null);
  }
  if (patch.lastSentAt !== undefined || patch.last_heartbeat_sent_at !== undefined) {
    sets.push('last_heartbeat_sent_at = ?');
    params.push(patch.lastSentAt ?? patch.last_heartbeat_sent_at ?? null);
  }

  sets.push('updated_at = ?');
  params.push(Date.now());
  params.push(1);

  await run(`UPDATE heartbeat_config SET ${sets.join(', ')} WHERE id = ?`, params);
  return getHeartbeatConfig();
}

export async function addCronSkill(skill) {
  const now = Date.now();
  const id = skill.id || _genId('skill');
  await run(
    `INSERT INTO cron_skills
     (id, name, allowed_tools, system_prompt, model, max_turns, timeout_ms, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      skill.name,
      skill.allowedTools == null ? null : JSON.stringify(skill.allowedTools),
      skill.systemPrompt || null,
      skill.model || null,
      Number(skill.maxTurns ?? 3),
      Number(skill.timeoutMs ?? 60000),
      now,
      now,
    ]
  );
  const row = await queryOne('SELECT * FROM cron_skills WHERE id = ?', [id]);
  return _toCronSkillRecord(row);
}

export async function updateCronSkill(id, patch = {}) {
  const sets = [];
  const params = [];

  if (patch.name !== undefined) {
    sets.push('name = ?');
    params.push(patch.name);
  }
  if (patch.allowedTools !== undefined || patch.allowed_tools !== undefined) {
    const value = patch.allowedTools ?? patch.allowed_tools;
    sets.push('allowed_tools = ?');
    params.push(value == null ? null : JSON.stringify(value));
  }
  if (patch.systemPrompt !== undefined || patch.system_prompt !== undefined) {
    sets.push('system_prompt = ?');
    params.push((patch.systemPrompt ?? patch.system_prompt) || null);
  }
  if (patch.model !== undefined) {
    sets.push('model = ?');
    params.push(patch.model || null);
  }
  if (patch.maxTurns !== undefined || patch.max_turns !== undefined) {
    sets.push('max_turns = ?');
    params.push(Number(patch.maxTurns ?? patch.max_turns ?? 3));
  }
  if (patch.timeoutMs !== undefined || patch.timeout_ms !== undefined) {
    sets.push('timeout_ms = ?');
    params.push(Number(patch.timeoutMs ?? patch.timeout_ms ?? 60000));
  }

  sets.push('updated_at = ?');
  params.push(Date.now());
  params.push(id);

  await run(`UPDATE cron_skills SET ${sets.join(', ')} WHERE id = ?`, params);
}

export async function removeCronSkill(id) {
  await run('DELETE FROM cron_skills WHERE id = ?', [id]);
}

export async function listCronSkills() {
  const rows = await query('SELECT * FROM cron_skills ORDER BY updated_at DESC');
  return rows.map(_toCronSkillRecord);
}

export async function addCronJob(job) {
  const now = Date.now();
  const id = job.id || _genId('job');
  const schedule = job.schedule || {};
  const activeHours = job.activeHours || {};
  const nextRunAt = job.nextRunAt ?? _resolveNextRunAt(schedule, now);
  await run(
    `INSERT INTO cron_jobs
     (id, name, enabled, session_target, wake_mode, schedule_kind, schedule_every_ms, schedule_anchor_ms, schedule_at_ms,
      skill_id, prompt, delivery_mode, delivery_webhook_url, delivery_notification_title,
      active_hours_start, active_hours_end, active_hours_tz,
      last_run_at, next_run_at, last_run_status, last_error, last_duration_ms,
      last_response_hash, last_response_sent_at, consecutive_errors, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      job.name,
      _toIntBool(job.enabled !== false),
      job.sessionTarget || 'isolated',
      job.wakeMode || 'next-heartbeat',
      schedule.kind,
      schedule.kind === 'every' ? Number(schedule.everyMs) || null : null,
      Number(schedule.anchorMs ?? job.scheduleAnchorMs) || null,
      schedule.kind === 'at' ? Number(schedule.atMs) || null : null,
      job.skillId,
      job.prompt,
      job.deliveryMode || 'notification',
      job.deliveryWebhookUrl || null,
      job.deliveryNotificationTitle || null,
      activeHours.start || null,
      activeHours.end || null,
      activeHours.tz || activeHours.timezone || null,
      job.lastRunAt || null,
      nextRunAt,
      job.lastRunStatus || null,
      job.lastError || null,
      job.lastDurationMs || null,
      job.lastResponseHash || null,
      job.lastResponseSentAt || null,
      Number(job.consecutiveErrors || 0),
      now,
      now,
    ]
  );
  const row = await queryOne('SELECT * FROM cron_jobs WHERE id = ?', [id]);
  return _toCronJobRecord(row);
}

export async function updateCronJob(id, patch = {}) {
  const sets = [];
  const params = [];

  if (patch.name !== undefined) {
    sets.push('name = ?');
    params.push(patch.name);
  }
  if (patch.enabled !== undefined) {
    sets.push('enabled = ?');
    params.push(_toIntBool(!!patch.enabled));
  }
  if (patch.sessionTarget !== undefined || patch.session_target !== undefined) {
    sets.push('session_target = ?');
    params.push((patch.sessionTarget ?? patch.session_target) || 'isolated');
  }
  if (patch.wakeMode !== undefined || patch.wake_mode !== undefined) {
    sets.push('wake_mode = ?');
    params.push((patch.wakeMode ?? patch.wake_mode) || 'next-heartbeat');
  }

  if (patch.schedule) {
    const schedule = patch.schedule;
    if (schedule.kind !== undefined) {
      sets.push('schedule_kind = ?');
      params.push(schedule.kind);
    }
    if (schedule.everyMs !== undefined || schedule.every_ms !== undefined) {
      sets.push('schedule_every_ms = ?');
      params.push(Number(schedule.everyMs ?? schedule.every_ms) || null);
    }
    if (schedule.anchorMs !== undefined || schedule.anchor_ms !== undefined) {
      sets.push('schedule_anchor_ms = ?');
      params.push(Number(schedule.anchorMs ?? schedule.anchor_ms) || null);
    }
    if (schedule.atMs !== undefined || schedule.at_ms !== undefined) {
      sets.push('schedule_at_ms = ?');
      params.push(Number(schedule.atMs ?? schedule.at_ms) || null);
    }
    if (patch.nextRunAt === undefined && patch.next_run_at === undefined) {
      sets.push('next_run_at = ?');
      params.push(_resolveNextRunAt(schedule, Date.now()));
    }
  } else {
    if (patch.scheduleKind !== undefined || patch.schedule_kind !== undefined) {
      sets.push('schedule_kind = ?');
      params.push(patch.scheduleKind ?? patch.schedule_kind);
    }
    if (patch.scheduleEveryMs !== undefined || patch.schedule_every_ms !== undefined) {
      sets.push('schedule_every_ms = ?');
      params.push(Number(patch.scheduleEveryMs ?? patch.schedule_every_ms) || null);
    }
    if (patch.scheduleAnchorMs !== undefined || patch.schedule_anchor_ms !== undefined) {
      sets.push('schedule_anchor_ms = ?');
      params.push(Number(patch.scheduleAnchorMs ?? patch.schedule_anchor_ms) || null);
    }
    if (patch.scheduleAtMs !== undefined || patch.schedule_at_ms !== undefined) {
      sets.push('schedule_at_ms = ?');
      params.push(Number(patch.scheduleAtMs ?? patch.schedule_at_ms) || null);
    }
  }

  if (patch.skillId !== undefined || patch.skill_id !== undefined) {
    sets.push('skill_id = ?');
    params.push((patch.skillId ?? patch.skill_id) || null);
  }
  if (patch.prompt !== undefined) {
    sets.push('prompt = ?');
    params.push(patch.prompt || '');
  }
  if (patch.deliveryMode !== undefined || patch.delivery_mode !== undefined) {
    sets.push('delivery_mode = ?');
    params.push((patch.deliveryMode ?? patch.delivery_mode) || 'notification');
  }
  if (patch.deliveryWebhookUrl !== undefined || patch.delivery_webhook_url !== undefined) {
    sets.push('delivery_webhook_url = ?');
    params.push((patch.deliveryWebhookUrl ?? patch.delivery_webhook_url) || null);
  }
  if (
    patch.deliveryNotificationTitle !== undefined ||
    patch.delivery_notification_title !== undefined
  ) {
    sets.push('delivery_notification_title = ?');
    params.push((patch.deliveryNotificationTitle ?? patch.delivery_notification_title) || null);
  }

  const activeHours = patch.activeHours || patch.active_hours;
  if (activeHours) {
    sets.push('active_hours_start = ?');
    params.push(activeHours.start || null);
    sets.push('active_hours_end = ?');
    params.push(activeHours.end || null);
    sets.push('active_hours_tz = ?');
    params.push(activeHours.tz || activeHours.timezone || null);
  } else {
    if (patch.active_hours_start !== undefined) {
      sets.push('active_hours_start = ?');
      params.push(patch.active_hours_start || null);
    }
    if (patch.active_hours_end !== undefined) {
      sets.push('active_hours_end = ?');
      params.push(patch.active_hours_end || null);
    }
    if (patch.active_hours_tz !== undefined) {
      sets.push('active_hours_tz = ?');
      params.push(patch.active_hours_tz || null);
    }
  }

  if (patch.lastRunAt !== undefined || patch.last_run_at !== undefined) {
    sets.push('last_run_at = ?');
    params.push(patch.lastRunAt ?? patch.last_run_at ?? null);
  }
  if (patch.nextRunAt !== undefined || patch.next_run_at !== undefined) {
    sets.push('next_run_at = ?');
    params.push(patch.nextRunAt ?? patch.next_run_at ?? null);
  }
  if (patch.lastRunStatus !== undefined || patch.last_run_status !== undefined) {
    sets.push('last_run_status = ?');
    params.push((patch.lastRunStatus ?? patch.last_run_status) || null);
  }
  if (patch.lastError !== undefined || patch.last_error !== undefined) {
    sets.push('last_error = ?');
    params.push((patch.lastError ?? patch.last_error) || null);
  }
  if (patch.lastDurationMs !== undefined || patch.last_duration_ms !== undefined) {
    sets.push('last_duration_ms = ?');
    params.push(patch.lastDurationMs ?? patch.last_duration_ms ?? null);
  }
  if (patch.lastResponseHash !== undefined || patch.last_response_hash !== undefined) {
    sets.push('last_response_hash = ?');
    params.push((patch.lastResponseHash ?? patch.last_response_hash) || null);
  }
  if (patch.lastResponseSentAt !== undefined || patch.last_response_sent_at !== undefined) {
    sets.push('last_response_sent_at = ?');
    params.push(patch.lastResponseSentAt ?? patch.last_response_sent_at ?? null);
  }
  if (patch.consecutiveErrors !== undefined || patch.consecutive_errors !== undefined) {
    sets.push('consecutive_errors = ?');
    params.push(Number(patch.consecutiveErrors ?? patch.consecutive_errors) || 0);
  }

  sets.push('updated_at = ?');
  params.push(Date.now());
  params.push(id);

  await run(`UPDATE cron_jobs SET ${sets.join(', ')} WHERE id = ?`, params);
}

export async function removeCronJob(id) {
  await run('DELETE FROM cron_jobs WHERE id = ?', [id]);
  await run('DELETE FROM cron_runs WHERE job_id = ?', [id]);
}

export async function listCronJobs() {
  const rows = await query('SELECT * FROM cron_jobs ORDER BY updated_at DESC');
  return rows.map(_toCronJobRecord);
}

export async function getDueJobs(nowMs = Date.now()) {
  const rows = await query(
    `SELECT * FROM cron_jobs
     WHERE enabled = 1
       AND next_run_at IS NOT NULL
       AND next_run_at <= ?
     ORDER BY next_run_at ASC`,
    [nowMs]
  );
  return rows.map(_toCronJobRecord);
}

export async function insertCronRun(runData) {
  await run(
    `INSERT INTO cron_runs
     (job_id, started_at, ended_at, status, duration_ms, error, response_text, was_heartbeat_ok, was_deduped, delivered, wake_source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      runData.jobId,
      runData.startedAt,
      runData.endedAt || null,
      runData.status || null,
      runData.durationMs || null,
      runData.error || null,
      runData.responseText || null,
      _toIntBool(!!runData.wasHeartbeatOk),
      _toIntBool(!!runData.wasDeduped),
      _toIntBool(!!runData.delivered),
      runData.wakeSource || null,
    ]
  );
  const row = await queryOne('SELECT last_insert_rowid() as id');
  return row?.id || null;
}

export async function listCronRuns(jobId = null, limit = 50) {
  const safeLimit = Math.max(1, Math.min(500, Number(limit) || 50));
  let rows;
  if (jobId) {
    rows = await query(
      'SELECT * FROM cron_runs WHERE job_id = ? ORDER BY started_at DESC LIMIT ?',
      [jobId, safeLimit]
    );
  } else {
    rows = await query(
      'SELECT * FROM cron_runs ORDER BY started_at DESC LIMIT ?',
      [safeLimit]
    );
  }
  return rows.map(_toCronRunRecord);
}

export async function enqueueSystemEvent(sessionKey, contextKey, text) {
  const createdAt = Date.now();
  await run(
    `INSERT INTO system_events
     (session_key, context_key, text, created_at, consumed)
     VALUES (?, ?, ?, ?, 0)`,
    [sessionKey, contextKey || null, text, createdAt]
  );
}

export async function peekPendingEvents(sessionKey) {
  const rows = await query(
    `SELECT id, session_key, context_key, text, created_at, consumed
     FROM system_events
     WHERE session_key = ? AND consumed = 0
     ORDER BY created_at ASC, id ASC`,
    [sessionKey]
  );
  return rows.map((row) => ({
    id: row.id,
    sessionKey: row.session_key,
    contextKey: row.context_key || undefined,
    text: row.text,
    createdAt: row.created_at,
    consumed: _toBool(row.consumed),
  }));
}

export async function consumePendingEvents(ids = []) {
  if (!Array.isArray(ids) || ids.length === 0) return;
  const placeholders = ids.map(() => '?').join(', ');
  await run(`UPDATE system_events SET consumed = 1 WHERE id IN (${placeholders})`, ids);
}
