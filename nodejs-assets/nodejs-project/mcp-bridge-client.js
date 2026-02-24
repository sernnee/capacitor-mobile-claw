/**
 * Lightweight MCP JSON-RPC client over the Capacitor-NodeJS bridge.
 *
 * This module runs in the Node.js worker and speaks the MCP protocol
 * (JSON-RPC 2.0) to the WebView-side MCP server via bridge messages.
 * It does NOT depend on @modelcontextprotocol/sdk — keeping the worker lean.
 *
 * Message format:
 *   Worker → WebView: { type: 'mcp.jsonrpc', payload: { jsonrpc:'2.0', id, method, params } }
 *   WebView → Worker: { type: 'mcp.jsonrpc.response', payload: { jsonrpc:'2.0', id, result/error } }
 */

let requestId = 0;
const pendingRequests = new Map(); // id → { resolve, reject, timer }

const DEFAULT_TIMEOUT = 10_000; // 10 seconds per request

/**
 * Initialize the MCP bridge client.
 *
 * @param {object} channel - The Capacitor-NodeJS bridge channel
 * @returns {{ listTools, callTool, destroy }}
 */
export function initMcpBridge(channel) {
  // Listen for JSON-RPC responses from the WebView MCP server
  channel.addListener('message', (event) => {
    if (!event || event.type !== 'mcp.jsonrpc.response') return;

    const msg = event.payload;
    if (!msg || msg.id === undefined) return;

    const pending = pendingRequests.get(msg.id);
    if (!pending) return;

    pendingRequests.delete(msg.id);
    clearTimeout(pending.timer);

    if (msg.error) {
      pending.reject(new Error(msg.error.message || 'MCP RPC error'));
    } else {
      pending.resolve(msg.result);
    }
  });

  /**
   * Send a JSON-RPC request to the WebView MCP server.
   * @param {string} method - e.g. 'tools/list', 'tools/call'
   * @param {object} params
   * @param {number} [timeout]
   * @returns {Promise<any>}
   */
  function rpcCall(method, params, timeout = DEFAULT_TIMEOUT) {
    const id = ++requestId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingRequests.delete(id);
        reject(new Error(`MCP RPC timeout: ${method} (${timeout}ms)`));
      }, timeout);

      pendingRequests.set(id, { resolve, reject, timer });

      channel.send('message', {
        type: 'mcp.jsonrpc',
        payload: { jsonrpc: '2.0', id, method, params: params || {} },
      });
    });
  }

  /**
   * Discover available MCP tools from the WebView server.
   * @returns {Promise<Array<{ name: string, description: string, inputSchema: object }>>}
   */
  async function listTools() {
    const result = await rpcCall('tools/list', {});
    return result.tools || [];
  }

  /**
   * Call an MCP tool by name.
   * @param {string} name - Tool name, e.g. 'ssh_exec', 'camera_take_photo'
   * @param {object} args - Tool arguments matching the inputSchema
   * @returns {Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }>}
   */
  async function callTool(name, args) {
    return rpcCall('tools/call', { name, arguments: args || {} }, 120_000);
  }

  /** Clean up pending requests. */
  function destroy() {
    for (const [id, pending] of pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error('MCP bridge destroyed'));
    }
    pendingRequests.clear();
  }

  return { listTools, callTool, destroy };
}
