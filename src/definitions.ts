/**
 * MobileClaw Capacitor Plugin — Public API definitions.
 *
 * This is a headless (no-UI) plugin that embeds an AI agent engine
 * on-device via Capacitor-NodeJS. The agent has file tools, code
 * execution, git integration, and 64+ MCP device tools.
 *
 * Usage:
 *   import { MobileClaw } from 'capacitor-mobile-claw'
 *
 *   await MobileClaw.init()
 *   const key = await MobileClaw.sendMessage('Hello agent')
 *   MobileClaw.onEvent('text_delta', (e) => console.log(e.text))
 */

// ── Core plugin interface ──────────────────────────────────────────────────

export interface MobileClawPlugin {
  /**
   * Initialize the embedded Node.js worker and MCP bridge.
   * Must be called once before any other method.
   * Resolves when the worker sends 'worker.ready'.
   */
  init(options?: MobileClawInitOptions): Promise<MobileClawReadyInfo>

  /**
   * Whether the plugin has been initialized and the worker is ready.
   */
  isReady(): Promise<{ ready: boolean }>

  // ── Agent control ────────────────────────────────────────────────────

  /**
   * Send a prompt to the agent. Returns the session key for this conversation.
   * Reuses the current session key for multi-turn conversations.
   */
  sendMessage(options: { prompt: string; agentId?: string }): Promise<{ sessionKey: string }>

  /**
   * Stop the currently running agent turn.
   */
  stopTurn(): Promise<void>

  /**
   * Approve or deny a tool execution request from the agent.
   */
  approveTool(options: { toolCallId: string; approved: boolean }): Promise<void>

  /**
   * Send a steering/follow-up message to a running agent turn.
   */
  steerAgent(options: { text: string }): Promise<void>

  // ── Configuration ────────────────────────────────────────────────────

  /**
   * Update worker configuration (e.g. set API key, provider, model).
   */
  updateConfig(options: { config: Record<string, unknown> }): Promise<void>

  /**
   * Get auth profile status from the worker.
   */
  getAuthStatus(): Promise<AuthStatus>

  // ── File operations ──────────────────────────────────────────────────

  /**
   * Read a file from the agent workspace.
   */
  readFile(options: { path: string }): Promise<FileReadResult>

  /**
   * Write a file to the agent workspace.
   */
  writeFile(options: { path: string; content: string }): Promise<void>

  // ── Session management ───────────────────────────────────────────────

  /**
   * List past sessions from the worker's JSONL store.
   */
  listSessions(options?: { agentId?: string }): Promise<SessionListResult>

  /**
   * Get the most recent session.
   */
  getLatestSession(options?: { agentId?: string }): Promise<SessionInfo | null>

  /**
   * Load message history for a session from JSONL transcript.
   */
  loadSessionHistory(options: { sessionKey: string; agentId?: string }): Promise<SessionHistoryResult>

  /**
   * Resume a previous session (hydrate agent with saved messages).
   */
  resumeSession(options: { sessionKey: string; agentId?: string }): Promise<void>

  /**
   * Clear the current conversation (local state; transcripts preserved).
   */
  clearConversation(): Promise<{ success: boolean }>

  /**
   * Set the current session key (e.g. for resuming a specific session).
   */
  setSessionKey(options: { sessionKey: string }): Promise<void>

  /**
   * Get the current session key.
   */
  getSessionKey(): Promise<{ sessionKey: string | null }>

  // ── Tool invocation (direct, without agent) ──────────────────────────

  /**
   * Invoke a worker tool directly (local file tools or MCP device tools).
   * Useful for testing or for direct tool access without running the agent.
   */
  invokeTool(options: { toolName: string; args?: Record<string, unknown> }): Promise<ToolInvokeResult>

  // ── Events ───────────────────────────────────────────────────────────

  /**
   * Register a listener for agent events.
   * Returns an unsubscribe function.
   */
  addListener(
    eventName: MobileClawEventName,
    handler: (event: MobileClawEvent) => void,
  ): Promise<{ remove: () => Promise<void> }>

  /**
   * Remove all listeners for an event type.
   */
  removeAllListeners(eventName?: MobileClawEventName): Promise<void>
}

// ── Init options ───────────────────────────────────────────────────────────

import type { DeviceTool } from './mcp/tools/types'

export interface MobileClawInitOptions {
  /** Enable bridge MCP transport (in-process device tools). Default: true. */
  enableBridge?: boolean
  /** Enable STOMP MCP transport (remote access). Default: false. */
  enableStomp?: boolean
  /** Custom STOMP config when enableStomp is true. */
  stompConfig?: StompConfig
  /** MCP device tools to register. Pass from an external tools package. */
  tools?: DeviceTool[]
  /** Worker startup timeout in ms. Default: 60000. */
  workerTimeout?: number
}

export interface StompConfig {
  brokerURL: string
  login: string
  passcode: string
  deviceId?: string
  reconnectDelay?: number
}

// ── Ready info ─────────────────────────────────────────────────────────────

export interface MobileClawReadyInfo {
  nodeVersion: string
  openclawRoot: string
  mcpToolCount: number
}

// ── Auth ───────────────────────────────────────────────────────────────────

export interface AuthStatus {
  hasKey: boolean
  masked: string
}

// ── File operations ────────────────────────────────────────────────────────

export interface FileReadResult {
  path: string
  content: string
  error?: string
}

// ── Sessions ───────────────────────────────────────────────────────────────

export interface SessionInfo {
  sessionKey: string
  sessionId?: string
  updatedAt: number
  model?: string
  totalTokens?: number
}

export interface SessionListResult {
  agentId: string
  sessions: SessionInfo[]
}

export interface SessionHistoryResult {
  sessionKey: string
  messages: unknown[]
  error?: string
}

// ── Tool invocation ────────────────────────────────────────────────────────

export interface ToolInvokeResult {
  toolName: string
  result?: unknown
  error?: string
}

// ── Events ─────────────────────────────────────────────────────────────────

export type MobileClawEventName = 'agentEvent' | 'agentCompleted' | 'agentError' | 'toolApprovalRequest' | 'workerReady'

export type MobileClawEvent =
  | AgentEvent
  | AgentCompletedEvent
  | AgentErrorEvent
  | ToolApprovalRequestEvent
  | WorkerReadyEvent

export interface AgentEvent {
  eventType: 'text_delta' | 'tool_use' | 'tool_result' | 'thinking' | 'error'
  data: Record<string, unknown>
}

export interface AgentCompletedEvent {
  sessionKey: string
  usage?: {
    inputTokens: number
    outputTokens: number
    totalTokens: number
  }
  durationMs: number
}

export interface AgentErrorEvent {
  error: string
  code?: string
}

export interface ToolApprovalRequestEvent {
  toolCallId: string
  toolName: string
  args: Record<string, unknown>
}

export interface WorkerReadyEvent {
  nodeVersion: string
  openclawRoot: string
  mcpToolCount?: number
}
