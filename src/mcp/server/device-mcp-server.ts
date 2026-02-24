/**
 * Device MCP Server Factory
 *
 * Creates an MCP Server instance that exposes device tools.
 * Implements the MCP Server protocol for device tool discovery and invocation.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import type { DeviceTool } from '../tools/types'

export function createDeviceMcpServer(tools: DeviceTool[]) {
  const server = new Server({ name: 'mcp-device', version: '1.0.0' }, { capabilities: { tools: {}, logging: {} } })

  // Handle tool listing — agent calls tools/list to discover available tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    console.log(`[MCP-Server] tools/list — returning ${tools.length} tools`)
    return {
      tools: tools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      })),
    }
  })

  // Handle tool execution — agent calls tools/call with name + arguments
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params
    const tool = tools.find((t) => t.name === name)

    if (!tool) {
      console.error(`[MCP-Server] Tool not found: ${name}`)
      return {
        content: [{ type: 'text' as const, text: `Tool "${name}" not found` }],
        isError: true,
      }
    }

    console.log(`[MCP-Server] Executing tool: ${name}`)

    try {
      const result = await tool.execute(args || {})
      const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2)

      return {
        content: [{ type: 'text' as const, text }],
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`[MCP-Server] Error executing ${name}:`, message)

      return {
        content: [{ type: 'text' as const, text: `Error executing ${name}: ${message}` }],
        isError: true,
      }
    }
  })

  return server
}
