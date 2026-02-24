/**
 * Bridge-based MCP Server Transport
 *
 * Implements the MCP SDK Transport interface over the Capacitor-NodeJS bridge.
 * This allows the Node.js worker (mobile-claw) to call MCP device tools
 * without going through a remote broker — communication is in-process via IPC.
 *
 * The worker sends JSON-RPC requests as { type: 'mcp.jsonrpc', payload: {...} }
 * and receives responses as { type: 'mcp.jsonrpc.response', payload: {...} }.
 */

import type { Transport, TransportSendOptions } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js'

export class BridgeServerTransport implements Transport {
  // Transport interface callbacks (set by MCP Server on connect)
  public onmessage?: <T extends JSONRPCMessage>(message: T) => void
  public onclose?: () => void
  public onerror?: (error: Error) => void
  public sessionId?: string

  private nodePlugin: any // Capacitor-NodeJS plugin reference
  private removeListener?: (() => void) | null = null
  private _started = false

  constructor(nodePlugin: any) {
    this.nodePlugin = nodePlugin
  }

  async start(): Promise<void> {
    if (this._started) return

    // Listen for MCP JSON-RPC messages from the Node.js worker.
    // The worker sends: channel.send('message', { type: 'mcp.jsonrpc', payload: {...} })
    // Capacitor-NodeJS wraps this as: { args: [{ type: 'mcp.jsonrpc', payload: {...} }] }
    const handle = await this.nodePlugin.addListener('message', (event: any) => {
      const msg = event?.args?.[0] ?? event
      if (!msg || msg.type !== 'mcp.jsonrpc') return

      try {
        const jsonRpcMessage = msg.payload as JSONRPCMessage
        console.log(
          `[MCP-Bridge] Received ${(jsonRpcMessage as any).method || 'response'} (id: ${(jsonRpcMessage as any).id})`,
        )
        this.onmessage?.(jsonRpcMessage)
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error))
        console.error('[MCP-Bridge] Error processing message:', err.message)
        this.onerror?.(err)
      }
    })

    this.removeListener = () => handle?.remove?.()
    this._started = true
    console.log('[MCP-Bridge] Transport started — listening for worker requests')
  }

  async send(message: JSONRPCMessage, _options?: TransportSendOptions): Promise<void> {
    if (!this.nodePlugin) {
      console.warn('[MCP-Bridge] Cannot send — plugin not available')
      return
    }

    console.log(`[MCP-Bridge] Sending response (id: ${(message as any).id})`)

    await this.nodePlugin.send({
      eventName: 'message',
      args: [{ type: 'mcp.jsonrpc.response', payload: message }],
    })
  }

  async close(): Promise<void> {
    this._started = false
    if (this.removeListener) {
      this.removeListener()
      this.removeListener = null
    }
    this.onclose?.()
    console.log('[MCP-Bridge] Transport closed')
  }

  get connected(): boolean {
    return this._started
  }
}
