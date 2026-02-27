/**
 * db-bridge-client.js — SQLite bridge client for the Node.js worker.
 *
 * Sends JSON-RPC 2.0 requests to the WebView-side native SQLite handler
 * via the Capacitor-NodeJS bridge channel. This replaces the in-process
 * sql.js (WASM SQLite) approach, enabling native SQLite on all platforms
 * including iOS where WASM is unavailable.
 *
 * Message format:
 *   Worker → WebView: { type: 'db.jsonrpc', payload: { jsonrpc:'2.0', id, method, params } }
 *   WebView → Worker: { type: 'db.jsonrpc.response', payload: { jsonrpc:'2.0', id, result/error } }
 */

let requestId = 0;
const pendingRequests = new Map(); // id → { resolve, reject, timer }

const DEFAULT_TIMEOUT = 15_000; // 15 seconds per request

/**
 * Initialize the DB bridge client.
 *
 * @param {object} channel - The Capacitor-NodeJS bridge channel
 * @returns {{ init, isReady, run, query, queryOne, transaction, flush, destroy }}
 */
export function initDbBridge(channel) {
  // Listen for JSON-RPC responses from the WebView DB handler
  channel.addListener('message', (event) => {
    if (!event || event.type !== 'db.jsonrpc.response') return;

    const msg = event.payload;
    if (!msg || msg.id === undefined) return;

    const pending = pendingRequests.get(msg.id);
    if (!pending) return;

    pendingRequests.delete(msg.id);
    clearTimeout(pending.timer);

    if (msg.error) {
      pending.reject(new Error(msg.error.message || 'DB RPC error'));
    } else {
      pending.resolve(msg.result);
    }
  });

  /**
   * Send a JSON-RPC request to the WebView DB handler.
   * @param {string} method
   * @param {object} params
   * @param {number} [timeout]
   * @returns {Promise<any>}
   */
  function rpcCall(method, params, timeout = DEFAULT_TIMEOUT) {
    const id = ++requestId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingRequests.delete(id);
        reject(new Error(`DB RPC timeout: ${method} (${timeout}ms)`));
      }, timeout);

      pendingRequests.set(id, { resolve, reject, timer });

      channel.send('message', {
        type: 'db.jsonrpc',
        payload: { jsonrpc: '2.0', id, method, params: params || {} },
      });
    });
  }

  /**
   * Initialize the native SQLite database (schema + migrations).
   * @returns {Promise<{ ready: true }>}
   */
  async function init() {
    return rpcCall('db.init', {}, 30_000); // longer timeout for first init
  }

  /**
   * Check if the database is ready.
   * @returns {Promise<boolean>}
   */
  async function isReady() {
    const result = await rpcCall('db.isReady', {});
    return result.ready;
  }

  /**
   * Execute a single parameterized statement (INSERT, UPDATE, DELETE).
   * @param {string} sql
   * @param {any[]} [params]
   * @returns {Promise<{ changes: number, lastId: number }>}
   */
  async function run(sql, params) {
    return rpcCall('db.run', { sql, params });
  }

  /**
   * Query rows from the database.
   * @param {string} sql
   * @param {any[]} [params]
   * @returns {Promise<object[]>}
   */
  async function query(sql, params) {
    const result = await rpcCall('db.query', { sql, params });
    return result.rows;
  }

  /**
   * Query a single row.
   * @param {string} sql
   * @param {any[]} [params]
   * @returns {Promise<object|null>}
   */
  async function queryOne(sql, params) {
    const result = await rpcCall('db.queryOne', { sql, params });
    return result.row;
  }

  /**
   * Run multiple statements in a single atomic transaction.
   * @param {Array<{sql: string, params?: any[]}>} statements
   * @returns {Promise<{ results: any[] }>}
   */
  async function transaction(statements) {
    return rpcCall('db.transaction', { statements }, 30_000);
  }

  /**
   * No-op — native SQLite auto-persists.
   * Kept for API compatibility with callers that previously called flush().
   */
  async function flush() {
    // no-op
  }

  /** Clean up pending requests. */
  function destroy() {
    for (const [id, pending] of pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error('DB bridge destroyed'));
    }
    pendingRequests.clear();
  }

  return { init, isReady, run, query, queryOne, transaction, flush, destroy };
}
