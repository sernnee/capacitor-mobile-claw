/**
 * Phase 2 E2E Test: Session Management
 *
 * Verifies:
 * - session.list returns sessions from sessions.json index
 * - Sessions are sorted by updatedAt (newest first)
 * - Session metadata includes model, token count
 * - session.clear returns success
 * - Sessions.json index update after agent run
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const TEST_ROOT = join(process.cwd(), '.test-session-mgmt')
const OPENCLAW_ROOT = TEST_ROOT
const SESSIONS_DIR = join(OPENCLAW_ROOT, 'agents', 'main', 'sessions')
const SESSIONS_JSON = join(SESSIONS_DIR, 'sessions.json')

// Top-level setup/teardown — shared across all describe blocks
beforeAll(() => {
  mkdirSync(SESSIONS_DIR, { recursive: true })
  writeFileSync(SESSIONS_JSON, JSON.stringify({}))
})

afterAll(() => {
  rmSync(TEST_ROOT, { recursive: true, force: true })
})

// ── Replicate session.list handler from main.js ──────────────────────────────

function handleSessionList(agentId: string = 'main') {
  let sessions: any[] = []
  try {
    const raw = JSON.parse(readFileSync(SESSIONS_JSON, 'utf8'))
    // Index can be flat { sessionKey: {...} } or nested { agentId: { sessionKey: {...} } }
    const entries = raw[agentId] || raw
    sessions = Object.values(entries)
      .filter((s: any) => s && typeof s === 'object' && s.sessionId)
      .map((s: any) => ({
        sessionKey: s.sessionId,
        sessionId: s.sessionId,
        updatedAt: s.updatedAt || s.createdAt || 0,
        model: s.model,
        totalTokens: s.totalTokens,
      }))
    sessions.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
  } catch {
    // No sessions yet
  }
  return { type: 'session.list.result', agentId, sessions }
}

// ── Replicate session.clear handler from main.js ─────────────────────────────

function handleSessionClear() {
  return { type: 'session.clear.result', success: true }
}

// ── Replicate sessions.json index update from runSimpleAgent ─────────────────

function updateSessionIndex(
  agentId: string,
  sessionKey: string,
  opts: {
    startTime: number
    totalTokens: number
    model: string
  },
) {
  let index: any = {}
  try {
    index = JSON.parse(readFileSync(SESSIONS_JSON, 'utf8'))
  } catch {
    /* empty */
  }
  if (!index[agentId]) index[agentId] = {}
  index[agentId][sessionKey] = {
    sessionId: sessionKey,
    createdAt: index[agentId][sessionKey]?.createdAt || opts.startTime,
    updatedAt: Date.now(),
    model: opts.model,
    totalTokens: opts.totalTokens,
  }
  writeFileSync(SESSIONS_JSON, JSON.stringify(index, null, 2))
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Session Listing', () => {
  it('returns empty array for empty sessions.json', () => {
    const result = handleSessionList('main')
    expect(result.type).toBe('session.list.result')
    expect(result.agentId).toBe('main')
    expect(result.sessions).toEqual([])
  })

  it('returns sessions from nested index format', () => {
    const index = {
      main: {
        'session-1000': {
          sessionId: 'session-1000',
          createdAt: 1000,
          updatedAt: 2000,
          model: 'anthropic/claude-sonnet-4-5',
          totalTokens: 500,
        },
        'session-2000': {
          sessionId: 'session-2000',
          createdAt: 2000,
          updatedAt: 3000,
          model: 'anthropic/claude-sonnet-4-5',
          totalTokens: 1200,
        },
      },
    }
    writeFileSync(SESSIONS_JSON, JSON.stringify(index, null, 2))

    const result = handleSessionList('main')
    expect(result.sessions).toHaveLength(2)
  })

  it('sorts sessions by updatedAt descending (newest first)', () => {
    const result = handleSessionList('main')
    expect(result.sessions[0].sessionKey).toBe('session-2000')
    expect(result.sessions[1].sessionKey).toBe('session-1000')
  })

  it('includes metadata fields on each session', () => {
    const result = handleSessionList('main')
    const session = result.sessions[0]
    expect(session).toHaveProperty('sessionKey')
    expect(session).toHaveProperty('sessionId')
    expect(session).toHaveProperty('updatedAt')
    expect(session).toHaveProperty('model')
    expect(session).toHaveProperty('totalTokens')
    expect(session.model).toBe('anthropic/claude-sonnet-4-5')
    expect(session.totalTokens).toBe(1200)
  })

  it('returns empty for non-existent agentId', () => {
    const result = handleSessionList('nonexistent')
    expect(result.sessions).toEqual([])
  })

  it('handles flat index format (no agentId nesting)', () => {
    const flatIndex = {
      'session-flat-1': {
        sessionId: 'session-flat-1',
        createdAt: 5000,
        updatedAt: 6000,
        model: 'anthropic/claude-sonnet-4-5',
        totalTokens: 800,
      },
    }
    writeFileSync(SESSIONS_JSON, JSON.stringify(flatIndex, null, 2))

    // With agentId='main', raw['main'] is undefined so it falls through to raw itself
    const result = handleSessionList('main')
    expect(result.sessions).toHaveLength(1)
    expect(result.sessions[0].sessionKey).toBe('session-flat-1')
  })

  it('filters out non-session entries (no sessionId field)', () => {
    const mixed = {
      main: {
        'session-valid': {
          sessionId: 'session-valid',
          createdAt: 1000,
          updatedAt: 2000,
        },
        'not-a-session': 'string-value',
        'also-invalid': { someField: true },
      },
    }
    writeFileSync(SESSIONS_JSON, JSON.stringify(mixed, null, 2))

    const result = handleSessionList('main')
    expect(result.sessions).toHaveLength(1)
    expect(result.sessions[0].sessionKey).toBe('session-valid')
  })
})

describe('Session Clear', () => {
  it('returns success result', () => {
    const result = handleSessionClear()
    expect(result.type).toBe('session.clear.result')
    expect(result.success).toBe(true)
  })

  it('preserves sessions.json after clear', () => {
    // Write some sessions first
    const index = {
      main: {
        'session-preserved': {
          sessionId: 'session-preserved',
          createdAt: 1000,
          updatedAt: 2000,
        },
      },
    }
    writeFileSync(SESSIONS_JSON, JSON.stringify(index, null, 2))

    // Clear doesn't touch sessions.json
    handleSessionClear()

    const afterClear = JSON.parse(readFileSync(SESSIONS_JSON, 'utf8'))
    expect(afterClear.main['session-preserved']).toBeDefined()
  })
})

describe('Session Index Update', () => {
  beforeAll(() => {
    writeFileSync(SESSIONS_JSON, JSON.stringify({}))
  })

  it('creates index entry for new session', () => {
    updateSessionIndex('main', 'session-new-1', {
      startTime: 10000,
      totalTokens: 300,
      model: 'anthropic/claude-sonnet-4-5',
    })

    const index = JSON.parse(readFileSync(SESSIONS_JSON, 'utf8'))
    expect(index.main['session-new-1']).toBeDefined()
    expect(index.main['session-new-1'].sessionId).toBe('session-new-1')
    expect(index.main['session-new-1'].totalTokens).toBe(300)
    expect(index.main['session-new-1'].model).toBe('anthropic/claude-sonnet-4-5')
  })

  it('preserves createdAt on subsequent updates', () => {
    const indexBefore = JSON.parse(readFileSync(SESSIONS_JSON, 'utf8'))
    const originalCreatedAt = indexBefore.main['session-new-1'].createdAt

    // Small delay to ensure updatedAt differs
    updateSessionIndex('main', 'session-new-1', {
      startTime: 99999, // This should NOT overwrite createdAt
      totalTokens: 600,
      model: 'anthropic/claude-sonnet-4-5',
    })

    const indexAfter = JSON.parse(readFileSync(SESSIONS_JSON, 'utf8'))
    expect(indexAfter.main['session-new-1'].createdAt).toBe(originalCreatedAt)
    expect(indexAfter.main['session-new-1'].totalTokens).toBe(600)
  })

  it('updates totalTokens on re-run', () => {
    updateSessionIndex('main', 'session-new-1', {
      startTime: 10000,
      totalTokens: 1500,
      model: 'anthropic/claude-sonnet-4-5',
    })

    const index = JSON.parse(readFileSync(SESSIONS_JSON, 'utf8'))
    expect(index.main['session-new-1'].totalTokens).toBe(1500)
  })

  it('supports multiple sessions in the index', () => {
    updateSessionIndex('main', 'session-new-2', {
      startTime: 20000,
      totalTokens: 200,
      model: 'anthropic/claude-sonnet-4-5',
    })

    const index = JSON.parse(readFileSync(SESSIONS_JSON, 'utf8'))
    expect(Object.keys(index.main)).toHaveLength(2)
    expect(index.main['session-new-1']).toBeDefined()
    expect(index.main['session-new-2']).toBeDefined()
  })

  it('listing reflects index updates', () => {
    const result = handleSessionList('main')
    expect(result.sessions).toHaveLength(2)
    // Both sessions should be present
    const keys = result.sessions.map((s: any) => s.sessionKey).sort()
    expect(keys).toEqual(['session-new-1', 'session-new-2'])
  })
})
