/**
 * Bridge protocol between the Web UI and the embedded Node.js worker.
 * Messages are JSON-serialized and passed via Capacitor-NodeJS message channel.
 */

// ── UI → Node.js ────────────────────────────────────────────────────────────

export interface AgentStartMessage {
  type: 'agent.start'
  agentId: string
  sessionKey: string
  prompt: string
  provider?: string
  model?: string
}

export interface AgentStopMessage {
  type: 'agent.stop'
}

export interface AgentSteerMessage {
  type: 'agent.steer'
  text: string
}

export interface ConfigUpdateMessage {
  type: 'config.update'
  config: Record<string, unknown>
}

export interface SessionListMessage {
  type: 'session.list'
  agentId: string
}

export interface ConfigStatusMessage {
  type: 'config.status'
}

export interface SessionClearMessage {
  type: 'session.clear'
}

export interface FileReadMessage {
  type: 'file.read'
  path: string
}

export interface FileWriteMessage {
  type: 'file.write'
  path: string
  content: string
}

export interface SkillToolDef {
  name: string
  description: string
  input_schema: Record<string, unknown>
  /** When true, the worker emits a bridge message with the tool input instead of returning a result */
  bridgeEvent?: string // e.g. 'setup.theme' — worker sends this message type to UI
}

export interface SkillStartMessage {
  type: 'skill.start'
  skill: string
  agentId?: string
  locale?: string // ISO 639-1: 'en', 'es', etc.
  /** Injected skill config — if provided, overrides worker defaults */
  config?: {
    systemPrompt: string
    milestones: string[]
    tools: SkillToolDef[]
    kickoff: string
  }
}

// ── Pre-execution hook (UI → Node.js) ─────────────────────────────────────

/**
 * Consumer responds to a pre-execution hook with (optionally transformed) args.
 * The worker will use these args for the actual tool execution.
 *
 * Set `deny: true` to cancel the tool execution entirely (e.g. approval denied,
 * biometric auth failed, or any policy-based rejection).
 */
export interface ToolPreExecuteResultMessage {
  type: 'tool.pre_execute.result'
  toolCallId: string
  args: Record<string, unknown>
  deny?: boolean
  denyReason?: string
}

export type UIToNodeMessage =
  | AgentStartMessage
  | AgentStopMessage
  | AgentSteerMessage
  | ConfigUpdateMessage
  | ConfigStatusMessage
  | SessionListMessage
  | SessionClearMessage
  | FileReadMessage
  | FileWriteMessage
  | SkillStartMessage
  | ToolPreExecuteResultMessage

// ── Node.js → UI ────────────────────────────────────────────────────────────

export interface AgentEventMessage {
  type: 'agent.event'
  eventType: 'text_delta' | 'tool_use' | 'tool_result' | 'thinking' | 'error'
  data: Record<string, unknown>
}

export interface AgentCompletedMessage {
  type: 'agent.completed'
  sessionKey: string
  usage?: {
    inputTokens: number
    outputTokens: number
    totalTokens: number
  }
  durationMs: number
}

export interface AgentErrorMessage {
  type: 'agent.error'
  error: string
  code?: string
}

export interface ReadyMessage {
  type: 'worker.ready'
  nodeVersion: string
  openclawRoot: string
}

export interface SessionListResultMessage {
  type: 'session.list.result'
  agentId: string
  sessions: Array<{
    sessionKey: string
    sessionId: string
    updatedAt: number
    model?: string
    totalTokens?: number
  }>
}

export interface FileReadResultMessage {
  type: 'file.read.result'
  path: string
  content: string
  error?: string
}

export interface ConfigStatusResultMessage {
  type: 'config.status.result'
  hasKey: boolean
  masked: string
}

export interface SessionClearResultMessage {
  type: 'session.clear.result'
  success: boolean
}

// ── Pre-execution hook (Node.js → UI) ─────────────────────────────────────

/**
 * Worker fires this before every tool execution, giving the consumer full
 * control over tool approval policy and argument transformation.
 *
 * The consumer MUST respond with `tool.pre_execute.result` to allow execution.
 * If no handler responds, the tool will be denied after the TTL expires
 * (safe-by-default).
 */
export interface ToolPreExecuteMessage {
  type: 'tool.pre_execute'
  toolCallId: string
  toolName: string
  args: Record<string, unknown>
}

/**
 * Worker notifies UI that a pre-execution hook timed out (2-min TTL).
 * The tool execution is cancelled.
 */
export interface ToolPreExecuteExpiredMessage {
  type: 'tool.pre_execute.expired'
  toolCallId: string
  toolName: string
}

export type NodeToUIMessage =
  | AgentEventMessage
  | AgentCompletedMessage
  | AgentErrorMessage
  | ReadyMessage
  | SessionListResultMessage
  | FileReadResultMessage
  | ConfigStatusResultMessage
  | SessionClearResultMessage
  | ToolPreExecuteMessage
  | ToolPreExecuteExpiredMessage
