/**
 * MobileClawEngine — Framework-agnostic core engine.
 *
 * This is the headless implementation of the MobileClaw plugin.
 * It manages the embedded Node.js worker, bridge communication,
 * MCP server lifecycle, and exposes all plugin API methods.
 *
 * Tool approval policy is NOT handled here — the consumer controls
 * policy via the pre-execution hook (tool.pre_execute events).
 *
 * No Vue, React, or any UI framework dependency.
 */

import type {
  AuthStatus,
  FileReadResult,
  MobileClawEvent,
  MobileClawEventName,
  MobileClawInitOptions,
  MobileClawReadyInfo,
  SessionHistoryResult,
  SessionInfo,
  SessionListResult,
  ToolInvokeResult,
} from './definitions'
import { McpServerManager, type McpServerOptions } from './mcp/mcp-server-manager'

type MessageHandler = (msg: any) => void

export class MobileClawEngine {
  // ── State ──────────────────────────────────────────────────────────────

  private _ready = false
  private _available = false
  private _nodeVersion: string | null = null
  private _openclawRoot: string | null = null
  private _mcpToolCount = 0
  private _loading = false
  private _error: string | null = null
  private _currentSessionKey: string | null = null

  private nodePlugin: any = null
  private listeners = new Map<string, Set<MessageHandler>>()
  private initPromise: Promise<MobileClawReadyInfo> | null = null
  private _mcpManager: McpServerManager | null = null

  // ── Public getters ─────────────────────────────────────────────────────

  get ready(): boolean {
    return this._ready
  }
  get available(): boolean {
    return this._available
  }
  get nodeVersion(): string | null {
    return this._nodeVersion
  }
  get openclawRoot(): string | null {
    return this._openclawRoot
  }
  get mcpToolCount(): number {
    return this._mcpToolCount
  }
  get loading(): boolean {
    return this._loading
  }
  get error(): string | null {
    return this._error
  }
  get currentSessionKey(): string | null {
    return this._currentSessionKey
  }

  /** Access the MCP server manager for status, restart, etc. */
  get mcpManager(): McpServerManager | null {
    return this._mcpManager
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────

  async init(options: MobileClawInitOptions = {}): Promise<MobileClawReadyInfo> {
    if (this.initPromise) return this.initPromise
    this.initPromise = this._doInit(options)
    return this.initPromise
  }

  private async _doInit(options: MobileClawInitOptions): Promise<MobileClawReadyInfo> {
    const { Capacitor } = await import('@capacitor/core')

    if (!Capacitor.isNativePlatform()) {
      this._available = false
      this._error = 'MobileClaw only works on native platforms (Android/iOS)'
      return { nodeVersion: '', openclawRoot: '', mcpToolCount: 0 }
    }

    this._loading = true
    this._error = null

    try {
      const { NodeJS } = await import('capacitor-nodejs')
      this.nodePlugin = NodeJS
      this._available = true

      // Register message listener FIRST — the worker may have already
      // emitted worker.ready before MCP init completes.
      this.nodePlugin.addListener('message', (event: any) => {
        const msg = event?.args?.[0] ?? event
        if (!msg || !msg.type) return
        this._dispatch(msg)
      })

      // Set up worker.ready promise before MCP init (captures early ready events)
      const timeout = options.workerTimeout ?? 60_000
      const readyPromise = new Promise<MobileClawReadyInfo>((resolve) => {
        const timer = setTimeout(() => {
          this._error = `Worker startup timeout (${timeout}ms)`
          this._loading = false
          resolve({ nodeVersion: '', openclawRoot: '', mcpToolCount: this._mcpToolCount })
        }, timeout)

        this._onMessage(
          'worker.ready',
          (msg) => {
            clearTimeout(timer)
            this._ready = true
            this._nodeVersion = msg.nodeVersion
            this._openclawRoot = msg.openclawRoot
            this._mcpToolCount = msg.mcpToolCount ?? this._mcpToolCount
            this._loading = false
            this._error = null
            resolve({
              nodeVersion: msg.nodeVersion,
              openclawRoot: msg.openclawRoot,
              mcpToolCount: this._mcpToolCount,
            })
          },
          { once: true },
        )
      })

      // Start MCP bridge (worker calls tools/list during init)
      try {
        this._mcpManager = new McpServerManager()
        const mcpOpts: McpServerOptions = {
          enableBridge: options.enableBridge !== false,
          enableStomp: options.enableStomp ?? false,
          stompConfig: options.stompConfig,
          tools: options.tools,
        }
        await this._mcpManager.start(mcpOpts)
        this._mcpToolCount = this._mcpManager.toolCount
        console.log(`[MobileClaw] MCP server started — ${this._mcpToolCount} tools`)
      } catch (mcpErr) {
        console.warn('[MobileClaw] MCP bridge start failed (non-fatal):', mcpErr)
      }

      const readyInfo = await readyPromise

      return readyInfo
    } catch (e: any) {
      this._available = false
      this._error = `Capacitor-NodeJS not available: ${e.message}`
      this._loading = false
      return { nodeVersion: '', openclawRoot: '', mcpToolCount: 0 }
    }
  }

  async isReady(): Promise<{ ready: boolean }> {
    return { ready: this._ready }
  }

  // ── Bridge communication ───────────────────────────────────────────────

  async send(message: Record<string, unknown>): Promise<void> {
    if (!this.nodePlugin) {
      console.warn('[MobileClaw] Cannot send — plugin not loaded')
      return
    }
    await this.nodePlugin.send({ eventName: 'message', args: [message] })
  }

  /** Internal message listener (returns unsubscribe fn) */
  private _onMessage(type: string, handler: MessageHandler, opts: { once?: boolean } = {}): () => void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set())
    }
    const wrapped = opts.once
      ? (msg: any) => {
          this.listeners.get(type)?.delete(wrapped)
          handler(msg)
        }
      : handler
    this.listeners.get(type)?.add(wrapped)
    return () => this.listeners.get(type)?.delete(wrapped)
  }

  private _dispatch(msg: any): void {
    // Type-specific handlers
    const handlers = this.listeners.get(msg.type)
    if (handlers) {
      for (const h of handlers) {
        try {
          h(msg)
        } catch (e) {
          console.error('[MobileClaw] handler error:', e)
        }
      }
    }
    // Wildcard handlers
    const wildcards = this.listeners.get('*')
    if (wildcards) {
      for (const h of wildcards) {
        try {
          h(msg)
        } catch (e) {
          console.error('[MobileClaw] wildcard error:', e)
        }
      }
    }
  }

  // ── Agent control ──────────────────────────────────────────────────────

  async sendMessage(prompt: string, agentId = 'main', options?: { model?: string }): Promise<{ sessionKey: string }> {
    if (!this._currentSessionKey) {
      this._currentSessionKey = `session-${Date.now()}`
    }
    const idempotencyKey =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`
    await this.send({
      type: 'agent.start',
      agentId,
      sessionKey: this._currentSessionKey,
      prompt,
      ...(options?.model && { model: options.model }),
      idempotencyKey,
    })
    return { sessionKey: this._currentSessionKey }
  }

  async getModels(): Promise<Array<{ id: string; name: string; description: string; default?: boolean }>> {
    return new Promise((resolve) => {
      this._onMessage('config.models.result', (msg) => resolve(msg.models || []), { once: true })
      this.send({ type: 'config.models' })
    })
  }

  async stopTurn(): Promise<void> {
    await this.send({ type: 'agent.stop' })
  }

  /**
   * Respond to a pre-execution hook event.
   * The consumer calls this to allow, deny, or transform tool arguments.
   */
  async respondToPreExecute(
    toolCallId: string,
    args: Record<string, unknown>,
    deny?: boolean,
    denyReason?: string,
  ): Promise<void> {
    await this.send({
      type: 'tool.pre_execute.result',
      toolCallId,
      args,
      ...(deny && { deny }),
      ...(denyReason && { denyReason }),
    })
  }

  async steerAgent(text: string): Promise<void> {
    await this.send({ type: 'agent.steer', text })
  }

  // ── Configuration ──────────────────────────────────────────────────────

  async updateConfig(config: Record<string, unknown>): Promise<void> {
    await this.send({ type: 'config.update', config })
  }

  async exchangeOAuthCode(tokenUrl: string, body: Record<string, string>): Promise<any> {
    return new Promise((resolve) => {
      this._onMessage('oauth.exchange.result', (msg) => resolve(msg), { once: true })
      this.send({ type: 'oauth.exchange', tokenUrl, body })
    })
  }

  async getAuthStatus(): Promise<AuthStatus> {
    return new Promise((resolve) => {
      this._onMessage('config.status.result', (msg) => resolve(msg), { once: true })
      this.send({ type: 'config.status' })
    })
  }

  // ── File operations ────────────────────────────────────────────────────

  async readFile(path: string): Promise<FileReadResult> {
    return new Promise((resolve) => {
      this._onMessage(
        'file.read.result',
        (msg) => {
          if (msg.path === path) resolve(msg)
        },
        { once: true },
      )
      this.send({ type: 'file.read', path })
    })
  }

  async writeFile(path: string, content: string): Promise<void> {
    await this.send({ type: 'file.write', path, content })
  }

  // ── Session management ─────────────────────────────────────────────────

  async listSessions(agentId = 'main'): Promise<SessionListResult> {
    return new Promise((resolve) => {
      this._onMessage('session.list.result', (msg) => resolve(msg), { once: true })
      this.send({ type: 'session.list', agentId })
    })
  }

  async getLatestSession(agentId = 'main'): Promise<SessionInfo | null> {
    return new Promise((resolve) => {
      this._onMessage('session.latest.result', (msg) => resolve(msg), { once: true })
      this.send({ type: 'session.latest', agentId })
    })
  }

  async loadSessionHistory(sessionKey: string, agentId = 'main'): Promise<SessionHistoryResult> {
    return new Promise((resolve) => {
      this._onMessage('session.load.result', (msg) => resolve(msg), { once: true })
      this.send({ type: 'session.load', sessionKey, agentId })
    })
  }

  async resumeSession(sessionKey: string, agentId = 'main'): Promise<void> {
    return new Promise((resolve) => {
      this._onMessage('session.resume.result', () => resolve(), { once: true })
      this.send({ type: 'session.resume', sessionKey, agentId })
    })
  }

  async clearConversation(): Promise<{ success: boolean }> {
    this._currentSessionKey = null
    return new Promise((resolve) => {
      this._onMessage('session.clear.result', (msg) => resolve(msg), { once: true })
      this.send({ type: 'session.clear' })
    })
  }

  async setSessionKey(sessionKey: string): Promise<void> {
    this._currentSessionKey = sessionKey
  }

  async getSessionKey(): Promise<{ sessionKey: string | null }> {
    return { sessionKey: this._currentSessionKey }
  }

  // ── Tool invocation ────────────────────────────────────────────────────

  async invokeTool(toolName: string, args: Record<string, unknown> = {}): Promise<ToolInvokeResult> {
    return new Promise((resolve) => {
      this._onMessage(
        'tool.invoke.result',
        (msg) => {
          if (msg.toolName === toolName) resolve(msg)
        },
        { once: true },
      )
      this.send({ type: 'tool.invoke', toolName, args })
    })
  }

  // ── Events (Capacitor plugin pattern) ──────────────────────────────────

  /**
   * Map from Capacitor event names to bridge message types.
   */
  private static readonly EVENT_MAP: Record<MobileClawEventName, string> = {
    agentEvent: 'agent.event',
    agentCompleted: 'agent.completed',
    agentError: 'agent.error',
    toolPreExecute: 'tool.pre_execute',
    toolPreExecuteExpired: 'tool.pre_execute.expired',
    workerReady: 'worker.ready',
  }

  addListener(eventName: MobileClawEventName, handler: (event: MobileClawEvent) => void): { remove: () => void } {
    const bridgeType = MobileClawEngine.EVENT_MAP[eventName]
    if (!bridgeType) {
      console.warn(`[MobileClaw] Unknown event: ${eventName}`)
      return { remove: () => {} }
    }
    const unsub = this._onMessage(bridgeType, handler)
    return { remove: unsub }
  }

  removeAllListeners(eventName?: MobileClawEventName): void {
    if (eventName) {
      const bridgeType = MobileClawEngine.EVENT_MAP[eventName]
      if (bridgeType) {
        this.listeners.delete(bridgeType)
      }
    } else {
      this.listeners.clear()
    }
  }

  // ── Low-level message listener (for advanced use / framework wrappers) ─

  /**
   * Register a handler for a specific bridge message type.
   * Useful for framework wrappers (Vue, React) that need raw bridge access.
   */
  onMessage(type: string, handler: MessageHandler, opts?: { once?: boolean }): () => void {
    return this._onMessage(type, handler, opts)
  }
}
