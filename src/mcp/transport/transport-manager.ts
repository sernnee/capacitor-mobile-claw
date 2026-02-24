/**
 * MCP Transport Manager
 *
 * Manages multiple concurrent transports for the device MCP server.
 * Each transport gets its own MCP Server instance (the SDK only supports
 * one transport per Server.connect()), but all instances share the same
 * DeviceTool array — so every transport sees the same tools.
 *
 * Usage:
 *   const manager = new TransportManager(() => enabledTools.value)
 *   await manager.addTransport('bridge', bridgeTransport)
 *   await manager.addTransport('stomp', stompTransport)  // opt-in
 *   await manager.removeTransport('stomp')
 *   await manager.closeAll()
 */

import type { Server } from '@modelcontextprotocol/sdk/server/index.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { createDeviceMcpServer } from '../server/device-mcp-server'
import type { DeviceTool } from '../tools/types'

interface TransportEntry {
  server: Server
  transport: Transport
}

export class TransportManager {
  private connections = new Map<string, TransportEntry>()
  private toolsFn: () => DeviceTool[]

  /**
   * @param toolsFn - Factory function that returns the current set of enabled tools.
   *                   Called each time a transport is added, so permission changes
   *                   take effect on next addTransport/restart.
   */
  constructor(toolsFn: () => DeviceTool[]) {
    this.toolsFn = toolsFn
  }

  /** Add and start a transport. Creates a dedicated MCP Server instance for it. */
  async addTransport(id: string, transport: Transport): Promise<void> {
    // Remove existing transport with same id if present
    if (this.connections.has(id)) {
      await this.removeTransport(id)
    }

    const tools = this.toolsFn()
    const server = createDeviceMcpServer(tools)

    await server.connect(transport)
    this.connections.set(id, { server, transport })

    console.log(`[TransportManager] Added transport "${id}" — ${tools.length} tools available`)
  }

  /** Stop and remove a transport by id. */
  async removeTransport(id: string): Promise<void> {
    const entry = this.connections.get(id)
    if (!entry) return

    try {
      await entry.transport.close()
    } catch (err) {
      console.warn(`[TransportManager] Error closing transport "${id}":`, err)
    }

    this.connections.delete(id)
    console.log(`[TransportManager] Removed transport "${id}"`)
  }

  /** Stop and remove all transports. */
  async closeAll(): Promise<void> {
    const ids = [...this.connections.keys()]
    for (const id of ids) {
      await this.removeTransport(id)
    }
  }

  /** Check if a specific transport is active. */
  hasTransport(id: string): boolean {
    return this.connections.has(id)
  }

  /** Get the list of active transport ids. */
  get activeTransports(): string[] {
    return [...this.connections.keys()]
  }
}
