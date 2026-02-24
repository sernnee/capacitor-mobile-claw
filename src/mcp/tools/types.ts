/**
 * Device MCP Tool interface
 *
 * Each tool exposes a device hardware capability or network operation
 * as a callable MCP tool. Tools are registered with the MCP server and
 * can be invoked by AI agents over AMQP.
 */
export interface DeviceTool {
  /** Unique tool name, e.g. 'ssh_exec', 'camera_take_photo' */
  name: string
  /** Human-readable description for AI agent tool discovery */
  description: string
  /** JSON Schema for tool parameters (generated from Zod via z.toJSONSchema) */
  inputSchema: Record<string, any>
  /** Execute the tool with validated arguments, return result object */
  execute: (args: Record<string, any>) => Promise<any>
}
