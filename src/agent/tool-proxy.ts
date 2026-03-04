/**
 * ToolProxy — Native tool execution.
 *
 * All tools run natively in the WebView via Capacitor plugins or WebAssembly.
 * No worker bridge needed.
 */

import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core'
import {
  editFileNative,
  findFilesNative,
  grepFilesNative,
  listFilesNative,
  readFileNative,
  writeFileNative,
} from './file-tools'
import { gitAddNative, gitCommitNative, gitDiffNative, gitInitNative, gitLogNative, gitStatusNative } from './git-tools'
import { TOOL_SCHEMAS } from './tool-schemas'
import { executeJsNative, executePythonNative } from './wasm-tools'

/** All tools execute natively — no worker bridge. */
const NATIVE_TOOLS: Record<string, (params: Record<string, unknown>) => Promise<AgentToolResult<unknown>>> = {
  execute_js: executeJsNative,
  execute_python: executePythonNative,
  read_file: readFileNative,
  write_file: writeFileNative,
  list_files: listFilesNative,
  grep_files: grepFilesNative,
  find_files: findFilesNative,
  edit_file: editFileNative,
  git_init: gitInitNative,
  git_status: gitStatusNative,
  git_add: gitAddNative,
  git_commit: gitCommitNative,
  git_log: gitLogNative,
  git_diff: gitDiffNative,
}

export class ToolProxy {
  /** @deprecated No worker — kept for API compat. */
  setBridge(_sendFn: (msg: Record<string, unknown>) => Promise<void>): void {}

  /** @deprecated No worker — kept for API compat. */
  setWorkerReady(): void {}

  /** @deprecated No worker — kept for API compat. */
  handleResult(_msg: { toolCallId: string; toolName: string; result?: unknown; error?: string }): void {}

  /**
   * Build AgentTool[] from the shared schemas. Each tool executes natively.
   */
  buildTools(): AgentTool<any>[] {
    return TOOL_SCHEMAS.map((schema) => ({
      name: schema.name,
      label: schema.label,
      description: schema.description,
      parameters: schema.parameters,
      execute: (_toolCallId: string, params: Record<string, unknown>) => {
        const nativeFn = NATIVE_TOOLS[schema.name]
        if (nativeFn) {
          return nativeFn(params)
        }
        // Should never happen — all tools are native now
        return Promise.resolve({
          content: [{ type: 'text' as const, text: `Unknown tool: ${schema.name}` }],
          details: { error: `Unknown tool: ${schema.name}` },
        })
      },
    }))
  }
}
