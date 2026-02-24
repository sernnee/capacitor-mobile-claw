/**
 * Phase 4 E2E Test: Approval Gate
 *
 * Verifies:
 * - APPROVAL_REQUIRED set contains correct tools
 * - wrapWithApproval sends approval_request and waits
 * - Approval resolves and tool executes
 * - Denial resolves and tool is skipped
 * - Abort cancels pending approvals
 * - Multiple pending approvals resolved independently
 * - tool.approve handler resolves correct pending approval
 * - Non-approval tools execute immediately
 */

import { beforeEach, describe, expect, it } from 'vitest'

// ── Replicate approval gate logic from main.js ───────────────────────────

const APPROVAL_REQUIRED = new Set(['write_file', 'edit_file', 'execute_js', 'git_commit'])

// Simplified pendingApprovals for testing
let pendingApprovals: Map<string, (approved: boolean) => void>
let sentMessages: any[]

function resetState() {
  pendingApprovals = new Map()
  sentMessages = []
}

// Simulated channel.send for capturing messages
function channelSend(msg: any) {
  sentMessages.push(msg)
}

function waitForApproval(toolCallId: string, signal?: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    pendingApprovals.set(toolCallId, resolve)

    if (signal) {
      const onAbort = () => {
        if (pendingApprovals.has(toolCallId)) {
          pendingApprovals.delete(toolCallId)
          resolve(false)
        }
      }
      signal.addEventListener('abort', onAbort, { once: true })
    }
  })
}

function wrapWithApproval(
  toolName: string,
  executeFn: (toolCallId: string, params: any, signal?: AbortSignal, onUpdate?: any) => Promise<any>,
) {
  return async (toolCallId: string, params: any, signal?: AbortSignal, onUpdate?: any) => {
    channelSend({
      type: 'tool.approval_request',
      toolCallId,
      toolName,
      args: params,
    })

    const approved = await waitForApproval(toolCallId, signal)

    if (!approved) {
      return {
        content: [{ type: 'text', text: 'Tool execution denied by user.' }],
        details: { denied: true },
      }
    }

    return executeFn(toolCallId, params, signal, onUpdate)
  }
}

// Simulated tool.approve handler
function handleToolApprove(msg: { toolCallId: string; approved: boolean }) {
  const resolver = pendingApprovals.get(msg.toolCallId)
  if (resolver) {
    pendingApprovals.delete(msg.toolCallId)
    resolver(msg.approved)
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('Approval Gate - APPROVAL_REQUIRED set', () => {
  it('write_file requires approval', () => {
    expect(APPROVAL_REQUIRED.has('write_file')).toBe(true)
  })

  it('edit_file requires approval', () => {
    expect(APPROVAL_REQUIRED.has('edit_file')).toBe(true)
  })

  it('execute_js requires approval', () => {
    expect(APPROVAL_REQUIRED.has('execute_js')).toBe(true)
  })

  it('git_commit requires approval', () => {
    expect(APPROVAL_REQUIRED.has('git_commit')).toBe(true)
  })

  it('read_file does NOT require approval', () => {
    expect(APPROVAL_REQUIRED.has('read_file')).toBe(false)
  })

  it('list_files does NOT require approval', () => {
    expect(APPROVAL_REQUIRED.has('list_files')).toBe(false)
  })

  it('grep_files does NOT require approval', () => {
    expect(APPROVAL_REQUIRED.has('grep_files')).toBe(false)
  })

  it('find_files does NOT require approval', () => {
    expect(APPROVAL_REQUIRED.has('find_files')).toBe(false)
  })

  it('git_status does NOT require approval', () => {
    expect(APPROVAL_REQUIRED.has('git_status')).toBe(false)
  })

  it('git_add does NOT require approval', () => {
    expect(APPROVAL_REQUIRED.has('git_add')).toBe(false)
  })

  it('git_log does NOT require approval', () => {
    expect(APPROVAL_REQUIRED.has('git_log')).toBe(false)
  })

  it('git_diff does NOT require approval', () => {
    expect(APPROVAL_REQUIRED.has('git_diff')).toBe(false)
  })

  it('git_init does NOT require approval', () => {
    expect(APPROVAL_REQUIRED.has('git_init')).toBe(false)
  })

  it('has exactly 4 tools requiring approval', () => {
    expect(APPROVAL_REQUIRED.size).toBe(4)
  })
})

describe('Approval Gate - Approval Flow', () => {
  beforeEach(() => {
    resetState()
  })

  it('sends approval_request message on tool call', async () => {
    const mockExecute = async () => ({
      content: [{ type: 'text' as const, text: 'done' }],
      details: {},
    })

    const wrapped = wrapWithApproval('write_file', mockExecute)

    // Start execution (will block on approval)
    const resultPromise = wrapped('toolu_1', { path: 'test.txt', content: 'hi' })

    // Check that approval_request was sent
    expect(sentMessages).toHaveLength(1)
    expect(sentMessages[0]).toEqual({
      type: 'tool.approval_request',
      toolCallId: 'toolu_1',
      toolName: 'write_file',
      args: { path: 'test.txt', content: 'hi' },
    })

    // Approve it
    handleToolApprove({ toolCallId: 'toolu_1', approved: true })

    const result = await resultPromise
    expect(result.content[0].text).toBe('done')
  })

  it('executes tool when approved', async () => {
    let executed = false
    const mockExecute = async () => {
      executed = true
      return { content: [{ type: 'text' as const, text: 'executed' }], details: {} }
    }

    const wrapped = wrapWithApproval('edit_file', mockExecute)
    const resultPromise = wrapped('toolu_2', { path: 'a.txt', old_text: 'x', new_text: 'y' })

    handleToolApprove({ toolCallId: 'toolu_2', approved: true })

    await resultPromise
    expect(executed).toBe(true)
  })

  it('returns denial message when denied', async () => {
    let executed = false
    const mockExecute = async () => {
      executed = true
      return { content: [{ type: 'text' as const, text: 'executed' }], details: {} }
    }

    const wrapped = wrapWithApproval('execute_js', mockExecute)
    const resultPromise = wrapped('toolu_3', { code: 'console.log("hi")' })

    handleToolApprove({ toolCallId: 'toolu_3', approved: false })

    const result = await resultPromise
    expect(executed).toBe(false)
    expect(result.content[0].text).toBe('Tool execution denied by user.')
    expect(result.details.denied).toBe(true)
  })

  it('abort cancels pending approval with denial', async () => {
    const mockExecute = async () => ({
      content: [{ type: 'text' as const, text: 'done' }],
      details: {},
    })

    const abortController = new AbortController()
    const wrapped = wrapWithApproval('git_commit', mockExecute)
    const resultPromise = wrapped('toolu_4', { message: 'fix' }, abortController.signal)

    // Abort
    abortController.abort()

    const result = await resultPromise
    expect(result.details.denied).toBe(true)
    expect(pendingApprovals.size).toBe(0)
  })

  it('handles multiple pending approvals independently', async () => {
    const mockExecute1 = async () => ({
      content: [{ type: 'text' as const, text: 'result1' }],
      details: { id: 1 },
    })
    const mockExecute2 = async () => ({
      content: [{ type: 'text' as const, text: 'result2' }],
      details: { id: 2 },
    })

    const wrapped1 = wrapWithApproval('write_file', mockExecute1)
    const wrapped2 = wrapWithApproval('edit_file', mockExecute2)

    const promise1 = wrapped1('toolu_a', { path: 'a.txt', content: 'a' })
    const promise2 = wrapped2('toolu_b', { path: 'b.txt', old_text: 'x', new_text: 'y' })

    expect(pendingApprovals.size).toBe(2)

    // Approve first, deny second
    handleToolApprove({ toolCallId: 'toolu_a', approved: true })
    handleToolApprove({ toolCallId: 'toolu_b', approved: false })

    const result1 = await promise1
    const result2 = await promise2

    expect(result1.details.id).toBe(1)
    expect(result2.details.denied).toBe(true)
  })

  it('ignores approve for unknown toolCallId', () => {
    expect(pendingApprovals.size).toBe(0)
    handleToolApprove({ toolCallId: 'toolu_unknown', approved: true })
    // No error thrown, nothing happens
    expect(pendingApprovals.size).toBe(0)
  })
})
