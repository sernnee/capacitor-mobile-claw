/**
 * Native JS/Python execution via capacitor-wasm-agent-tools.
 *
 * Replaces the Node.js worker's vm.createContext (JS) and Pyodide (Python)
 * with Rust-native QuickJS and RustPython running inside wasmtime WASI.
 * Called directly from the WebView — no worker round-trip needed.
 */

import type { AgentToolResult } from '@mariozechner/pi-agent-core'

let WasmAgentTools: any = null
let jsReady = false
let pythonReady = false

async function getPlugin() {
  if (!WasmAgentTools) {
    const mod = await import('capacitor-wasm-agent-tools')
    WasmAgentTools = mod.WasmAgentTools
  }
  return WasmAgentTools
}

export async function executeJsNative(params: Record<string, unknown>): Promise<AgentToolResult<unknown>> {
  try {
    const plugin = await getPlugin()
    if (!jsReady) {
      await plugin.createJsRuntime()
      jsReady = true
    }
    const result = await plugin.executeJs({ code: params.code as string })
    const raw = {
      stdout: result.output,
      result: result.output.trim() || undefined,
      error: result.error || undefined,
    }
    return {
      content: [{ type: 'text', text: JSON.stringify(raw) }],
      details: raw,
    }
  } catch (err: any) {
    const raw = { error: err?.message || 'JS execution failed' }
    return {
      content: [{ type: 'text', text: JSON.stringify(raw) }],
      details: raw,
    }
  }
}

export async function executePythonNative(params: Record<string, unknown>): Promise<AgentToolResult<unknown>> {
  try {
    const plugin = await getPlugin()
    if (!pythonReady) {
      await plugin.createPythonRuntime()
      pythonReady = true
    }
    const result = await plugin.executePython({ code: params.code as string })
    const raw = {
      stdout: result.output,
      result: result.output.trim() || undefined,
      error: result.error || undefined,
    }
    return {
      content: [{ type: 'text', text: JSON.stringify(raw) }],
      details: raw,
    }
  } catch (err: any) {
    const raw = { error: err?.message || 'Python execution failed' }
    return {
      content: [{ type: 'text', text: JSON.stringify(raw) }],
      details: raw,
    }
  }
}
