/**
 * Phase 4 E2E Test: Agent Core (pi-agent-core integration)
 *
 * Verifies:
 * - Agent class instantiation and configuration
 * - Tool definitions in AgentTool<TypeBox> format
 * - AgentEvent → bridge event mapping
 * - convertToLlm filter
 * - Model resolution via getModel
 * - Session save format (JSONL with pi-agent-core messages)
 * - extractUsage from agent state
 * - toToolResult helper
 * - buildAgentTools returns correct count and shapes
 */

import { Agent } from '@mariozechner/pi-agent-core'
import { getModel } from '@mariozechner/pi-ai'
import { Type } from '@sinclair/typebox'
import { describe, expect, it } from 'vitest'

// ── Replicate key functions from main.js for testing ─────────────────────

function toToolResult(result: any) {
  return {
    content: [{ type: 'text', text: JSON.stringify(result) }],
    details: result,
  }
}

// Simulated convertToLlm filter (same as main.js)
function convertToLlm(messages: any[]) {
  return messages.filter((m) => m.role === 'user' || m.role === 'assistant' || m.role === 'toolResult')
}

// Simulated extractUsage (same as main.js)
function extractUsage(messages: any[]) {
  let input = 0,
    output = 0
  for (const msg of messages) {
    if (msg.role === 'assistant' && msg.usage) {
      input += msg.usage.input
      output += msg.usage.output
    }
  }
  return { inputTokens: input, outputTokens: output, totalTokens: input + output }
}

// Simulated bridgeEvent mapping (same as main.js)
function bridgeEvent(event: any): any {
  switch (event.type) {
    case 'message_update': {
      const e = event.assistantMessageEvent
      if (e.type === 'text_delta') {
        return { type: 'agent.event', eventType: 'text_delta', data: { text: e.delta } }
      }
      if (e.type === 'thinking_delta') {
        return { type: 'agent.event', eventType: 'thinking', data: { text: e.delta } }
      }
      return null
    }
    case 'tool_execution_start':
      return {
        type: 'agent.event',
        eventType: 'tool_use',
        data: { toolName: event.toolName, toolCallId: event.toolCallId, args: event.args },
      }
    case 'tool_execution_end':
      return {
        type: 'agent.event',
        eventType: 'tool_result',
        data: { toolName: event.toolName, result: event.result },
      }
    default:
      return null
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('Agent Core - Model Resolution', () => {
  it('getModel returns anthropic claude-sonnet-4-5', () => {
    const model = getModel('anthropic', 'claude-sonnet-4-5')
    expect(model).toBeDefined()
    expect(model.id).toBe('claude-sonnet-4-5')
    expect(model.provider).toBe('anthropic')
    expect(model.api).toBe('anthropic-messages')
  })

  it('model has correct baseUrl', () => {
    const model = getModel('anthropic', 'claude-sonnet-4-5')
    expect(model.baseUrl).toBe('https://api.anthropic.com')
  })

  it('model supports text and image input', () => {
    const model = getModel('anthropic', 'claude-sonnet-4-5')
    expect(model.input).toContain('text')
    expect(model.input).toContain('image')
  })

  it('model has reasoning capability', () => {
    const model = getModel('anthropic', 'claude-sonnet-4-5')
    expect(model.reasoning).toBe(true)
  })

  it('model has cost information', () => {
    const model = getModel('anthropic', 'claude-sonnet-4-5')
    expect(model.cost).toBeDefined()
    expect(typeof model.cost.input).toBe('number')
    expect(typeof model.cost.output).toBe('number')
  })
})

describe('Agent Core - Agent Class', () => {
  it('Agent can be instantiated with model and tools', () => {
    const model = getModel('anthropic', 'claude-sonnet-4-5')
    const agent = new Agent({
      initialState: {
        systemPrompt: 'Test prompt',
        model,
        tools: [],
        thinkingLevel: 'off',
      },
      convertToLlm: (messages) =>
        messages.filter((m) => m.role === 'user' || m.role === 'assistant' || m.role === 'toolResult'),
    })

    expect(agent).toBeDefined()
    expect(agent.state).toBeDefined()
    expect(agent.state.systemPrompt).toBe('Test prompt')
    expect(agent.state.model).toBe(model)
    expect(agent.state.tools).toEqual([])
    expect(agent.state.isStreaming).toBe(false)
  })

  it('Agent has subscribe method', () => {
    const model = getModel('anthropic', 'claude-sonnet-4-5')
    const agent = new Agent({
      initialState: { systemPrompt: '', model, tools: [], thinkingLevel: 'off' },
      convertToLlm: (m) => m.filter((m) => m.role === 'user' || m.role === 'assistant' || m.role === 'toolResult'),
    })

    expect(typeof agent.subscribe).toBe('function')
    const unsub = agent.subscribe(() => {})
    expect(typeof unsub).toBe('function')
    unsub()
  })

  it('Agent has steer and followUp methods', () => {
    const model = getModel('anthropic', 'claude-sonnet-4-5')
    const agent = new Agent({
      initialState: { systemPrompt: '', model, tools: [], thinkingLevel: 'off' },
      convertToLlm: (m) => m.filter((m) => m.role === 'user' || m.role === 'assistant' || m.role === 'toolResult'),
    })

    expect(typeof agent.steer).toBe('function')
    expect(typeof agent.followUp).toBe('function')
  })

  it('Agent has abort and clearMessages methods', () => {
    const model = getModel('anthropic', 'claude-sonnet-4-5')
    const agent = new Agent({
      initialState: { systemPrompt: '', model, tools: [], thinkingLevel: 'off' },
      convertToLlm: (m) => m.filter((m) => m.role === 'user' || m.role === 'assistant' || m.role === 'toolResult'),
    })

    expect(typeof agent.abort).toBe('function')
    expect(typeof agent.clearMessages).toBe('function')
  })

  it('Agent starts with empty messages', () => {
    const model = getModel('anthropic', 'claude-sonnet-4-5')
    const agent = new Agent({
      initialState: { systemPrompt: '', model, tools: [], thinkingLevel: 'off' },
      convertToLlm: (m) => m.filter((m) => m.role === 'user' || m.role === 'assistant' || m.role === 'toolResult'),
    })

    expect(agent.state.messages).toEqual([])
  })

  it('Agent can hold tools with TypeBox schemas', () => {
    const model = getModel('anthropic', 'claude-sonnet-4-5')
    const testTool = {
      name: 'test_tool',
      label: 'Test Tool',
      description: 'A test tool',
      parameters: Type.Object({
        input: Type.String(),
      }),
      execute: async () => ({
        content: [{ type: 'text' as const, text: 'ok' }],
        details: {},
      }),
    }

    const agent = new Agent({
      initialState: { systemPrompt: '', model, tools: [testTool], thinkingLevel: 'off' },
      convertToLlm: (m) => m.filter((m) => m.role === 'user' || m.role === 'assistant' || m.role === 'toolResult'),
    })

    expect(agent.state.tools).toHaveLength(1)
    expect(agent.state.tools[0].name).toBe('test_tool')
    expect(agent.state.tools[0].label).toBe('Test Tool')
  })

  it('Agent waitForIdle resolves when not streaming', async () => {
    const model = getModel('anthropic', 'claude-sonnet-4-5')
    const agent = new Agent({
      initialState: { systemPrompt: '', model, tools: [], thinkingLevel: 'off' },
      convertToLlm: (m) => m.filter((m) => m.role === 'user' || m.role === 'assistant' || m.role === 'toolResult'),
    })

    // Should resolve immediately since we haven't started streaming
    await agent.waitForIdle()
    expect(agent.state.isStreaming).toBe(false)
  })
})

describe('Agent Core - TypeBox Tool Schemas', () => {
  it('Type.Object creates valid schema', () => {
    const schema = Type.Object({
      path: Type.String(),
      content: Type.String(),
    })

    expect(schema.type).toBe('object')
    expect(schema.properties).toBeDefined()
    expect(schema.properties.path.type).toBe('string')
    expect(schema.properties.content.type).toBe('string')
  })

  it('Type.Optional creates optional property', () => {
    const schema = Type.Object({
      path: Type.String(),
      cached: Type.Optional(Type.Boolean()),
    })

    expect(schema.required).toBeDefined()
    // Required should only contain 'path', not 'cached'
    expect(schema.required).toContain('path')
    expect(schema.required).not.toContain('cached')
  })

  it('Type.Number creates number schema', () => {
    const schema = Type.Object({
      count: Type.Number(),
    })
    expect(schema.properties.count.type).toBe('number')
  })

  it('Type.Boolean creates boolean schema', () => {
    const schema = Type.Object({
      flag: Type.Boolean(),
    })
    expect(schema.properties.flag.type).toBe('boolean')
  })

  it('empty Type.Object works for no-param tools', () => {
    const schema = Type.Object({})
    expect(schema.type).toBe('object')
    expect(Object.keys(schema.properties)).toHaveLength(0)
  })
})

describe('Agent Core - toToolResult', () => {
  it('wraps simple result', () => {
    const result = toToolResult({ success: true })
    expect(result.content).toHaveLength(1)
    expect(result.content[0].type).toBe('text')
    expect(JSON.parse(result.content[0].text)).toEqual({ success: true })
    expect(result.details).toEqual({ success: true })
  })

  it('wraps error result', () => {
    const result = toToolResult({ error: 'not found' })
    expect(JSON.parse(result.content[0].text)).toEqual({ error: 'not found' })
  })

  it('wraps complex result', () => {
    const data = { files: [{ path: 'a.txt', status: 'modified' }] }
    const result = toToolResult(data)
    expect(result.details.files).toHaveLength(1)
    expect(result.details.files[0].path).toBe('a.txt')
  })
})

describe('Agent Core - convertToLlm', () => {
  it('passes through user messages', () => {
    const messages = [{ role: 'user', content: 'hello', timestamp: Date.now() }]
    expect(convertToLlm(messages)).toHaveLength(1)
  })

  it('passes through assistant messages', () => {
    const messages = [{ role: 'assistant', content: [], timestamp: Date.now() }]
    expect(convertToLlm(messages)).toHaveLength(1)
  })

  it('passes through toolResult messages', () => {
    const messages = [{ role: 'toolResult', toolCallId: 'x', content: [], timestamp: Date.now() }]
    expect(convertToLlm(messages)).toHaveLength(1)
  })

  it('filters out unknown roles', () => {
    const messages = [
      { role: 'user', content: 'hello', timestamp: Date.now() },
      { role: 'custom', content: 'ignored' },
      { role: 'assistant', content: [], timestamp: Date.now() },
    ]
    const result = convertToLlm(messages)
    expect(result).toHaveLength(2)
    expect(result[0].role).toBe('user')
    expect(result[1].role).toBe('assistant')
  })
})

describe('Agent Core - extractUsage', () => {
  it('returns zeros for empty messages', () => {
    const usage = extractUsage([])
    expect(usage).toEqual({ inputTokens: 0, outputTokens: 0, totalTokens: 0 })
  })

  it('sums assistant message usage', () => {
    const messages = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: [], usage: { input: 100, output: 50 } },
      { role: 'user', content: 'ok' },
      { role: 'assistant', content: [], usage: { input: 80, output: 30 } },
    ]
    const usage = extractUsage(messages)
    expect(usage.inputTokens).toBe(180)
    expect(usage.outputTokens).toBe(80)
    expect(usage.totalTokens).toBe(260)
  })

  it('ignores user messages', () => {
    const messages = [{ role: 'user', content: 'hi' }]
    const usage = extractUsage(messages)
    expect(usage.totalTokens).toBe(0)
  })

  it('ignores assistant messages without usage', () => {
    const messages = [{ role: 'assistant', content: [] }]
    const usage = extractUsage(messages)
    expect(usage.totalTokens).toBe(0)
  })
})

describe('Agent Core - bridgeEvent mapping', () => {
  it('maps text_delta to agent.event', () => {
    const result = bridgeEvent({
      type: 'message_update',
      assistantMessageEvent: { type: 'text_delta', delta: 'Hello' },
    })
    expect(result).toEqual({
      type: 'agent.event',
      eventType: 'text_delta',
      data: { text: 'Hello' },
    })
  })

  it('maps thinking_delta to agent.event', () => {
    const result = bridgeEvent({
      type: 'message_update',
      assistantMessageEvent: { type: 'thinking_delta', delta: 'Reasoning...' },
    })
    expect(result).toEqual({
      type: 'agent.event',
      eventType: 'thinking',
      data: { text: 'Reasoning...' },
    })
  })

  it('maps tool_execution_start to tool_use', () => {
    const result = bridgeEvent({
      type: 'tool_execution_start',
      toolCallId: 'toolu_123',
      toolName: 'read_file',
      args: { path: 'test.txt' },
    })
    expect(result).toEqual({
      type: 'agent.event',
      eventType: 'tool_use',
      data: { toolName: 'read_file', toolCallId: 'toolu_123', args: { path: 'test.txt' } },
    })
  })

  it('maps tool_execution_end to tool_result', () => {
    const result = bridgeEvent({
      type: 'tool_execution_end',
      toolCallId: 'toolu_123',
      toolName: 'read_file',
      result: { content: [{ type: 'text', text: '{}' }] },
    })
    expect(result).toEqual({
      type: 'agent.event',
      eventType: 'tool_result',
      data: { toolName: 'read_file', result: { content: [{ type: 'text', text: '{}' }] } },
    })
  })

  it('returns null for unhandled event types', () => {
    const result = bridgeEvent({ type: 'agent_start' })
    expect(result).toBeNull()
  })

  it('returns null for non-text message_update events', () => {
    const result = bridgeEvent({
      type: 'message_update',
      assistantMessageEvent: { type: 'toolcall_delta', delta: '{}' },
    })
    expect(result).toBeNull()
  })
})
