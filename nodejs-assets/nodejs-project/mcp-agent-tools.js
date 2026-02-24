/**
 * MCP-to-AgentTool adapter.
 *
 * Converts MCP tool descriptors (from tools/list) into pi-agent-core AgentTool
 * format so the on-device agent can call device MCP tools alongside its native
 * file/git/code tools.
 *
 * The adapter wraps each MCP tool's JSON Schema inputSchema with TypeBox's
 * Type.Unsafe() — this is a pass-through that satisfies pi-agent-core's
 * TypeBox requirement while preserving the original JSON Schema for the LLM.
 */

import { Type } from '@sinclair/typebox';

/**
 * Build pi-agent-core AgentTool[] from MCP tool descriptors.
 *
 * @param {object} mcpClient - The MCP bridge client ({ callTool })
 * @param {Array<{ name: string, description: string, inputSchema: object }>} mcpTools
 * @returns {Array} AgentTool-compatible objects
 */
export function buildMcpAgentTools(mcpClient, mcpTools) {
  return mcpTools.map(tool => ({
    name: tool.name,
    label: tool.name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
    description: `[Device] ${tool.description}`,
    parameters: Type.Unsafe(tool.inputSchema || { type: 'object', properties: {} }),
    execute: async (_toolCallId, params) => {
      try {
        const result = await mcpClient.callTool(tool.name, params);

        // MCP returns { content: [{ type: 'text', text: '...' }], isError?: boolean }
        const text = result?.content
          ?.filter(c => c.type === 'text')
          .map(c => c.text)
          .join('\n') || JSON.stringify(result);

        if (result?.isError) {
          return {
            content: [{ type: 'text', text: `Error: ${text}` }],
            details: { error: text },
          };
        }

        return {
          content: [{ type: 'text', text }],
          details: result,
        };
      } catch (err) {
        return {
          content: [{ type: 'text', text: `MCP tool error: ${err.message}` }],
          details: { error: err.message },
        };
      }
    },
  }));
}
