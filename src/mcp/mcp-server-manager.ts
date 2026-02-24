/**
 * MCP Server Manager — Framework-agnostic lifecycle manager.
 *
 * Replaces the Vue composable `useMcpServer.ts` with a plain class.
 * Manages MCP bridge/STOMP transports and device tool discovery.
 */

import type { StompConfig } from '../definitions'
import type { DeviceTool } from './tools/types'
import { BridgeServerTransport } from './transport/bridge-server-transport'
import { TransportManager } from './transport/transport-manager'

export type McpStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

export interface McpServerOptions {
  enableBridge?: boolean
  enableStomp?: boolean
  stompConfig?: StompConfig
  /** MCP device tools to register. Provided by the caller (e.g. from a tools package). */
  tools?: DeviceTool[]
}

export class McpServerManager {
  private manager: TransportManager | null = null
  private _status: McpStatus = 'disconnected'
  private _error: string | null = null
  private _deviceId: string | null = null
  private _toolCount = 0
  private _activeTransports: string[] = []

  get status(): McpStatus {
    return this._status
  }
  get error(): string | null {
    return this._error
  }
  get deviceId(): string | null {
    return this._deviceId
  }
  get toolCount(): number {
    return this._toolCount
  }
  get activeTransports(): string[] {
    return this._activeTransports
  }

  async start(options: McpServerOptions = {}): Promise<void> {
    const { Capacitor } = await import('@capacitor/core')

    if (!Capacitor.isNativePlatform()) {
      console.log('[MCP] Skipping — not a native platform')
      return
    }

    if (this._status === 'connected' || this._status === 'connecting') return

    this._status = 'connecting'
    this._error = null

    try {
      // Get device identifier
      const { Device } = await import('@capacitor/device')
      const info = await Device.getId()
      this._deviceId = info.identifier

      console.log(`[MCP] Starting MCP server for device ${info.identifier}`)

      // Use tools provided by the caller (from an external tools package)
      const tools = options.tools ?? []
      if (tools.length === 0) {
        console.warn('[MCP] No tools provided — MCP server will have zero device tools')
      }
      this._toolCount = tools.length

      // Create transport manager
      this.manager = new TransportManager(() => tools)

      // Bridge transport: ON by default
      if (options.enableBridge !== false) {
        const { NodeJS } = await import('capacitor-nodejs')
        const bridgeTransport = new BridgeServerTransport(NodeJS)
        await this.manager.addTransport('bridge', bridgeTransport)
        console.log('[MCP] Bridge transport active — worker can call device tools')
      }

      // STOMP transport: OFF by default
      if (options.enableStomp && options.stompConfig) {
        const { StompServerTransport } = await import('./transport/stomp-server-transport')
        const stompTransport = new StompServerTransport({
          brokerURL: options.stompConfig.brokerURL,
          login: options.stompConfig.login,
          passcode: options.stompConfig.passcode,
          deviceId: options.stompConfig.deviceId ?? info.identifier,
          reconnectDelay: options.stompConfig.reconnectDelay,
        })
        await this.manager.addTransport('stomp', stompTransport)
        console.log('[MCP] STOMP transport active')
      }

      this._activeTransports = this.manager.activeTransports
      this._status = 'connected'
      console.log(`[MCP] Server running — ${tools.length} tools, transports: [${this._activeTransports.join(', ')}]`)
    } catch (err) {
      this._status = 'error'
      this._error = err instanceof Error ? err.message : String(err)
      console.error('[MCP] Failed to start:', this._error)
    }
  }

  async stop(): Promise<void> {
    if (this.manager) {
      await this.manager.closeAll()
      this.manager = null
    }
    this._activeTransports = []
    this._status = 'disconnected'
    console.log('[MCP] Server stopped')
  }

  async restart(options?: McpServerOptions): Promise<void> {
    await this.stop()
    await this.start(options)
  }
}
