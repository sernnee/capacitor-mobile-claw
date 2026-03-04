/**
 * capacitor-mobile-claw — On-device AI agent engine for Capacitor apps.
 *
 * Usage:
 *   import { MobileClaw } from 'capacitor-mobile-claw'
 *
 *   const engine = MobileClawEngine.getInstance()
 *   await engine.init()
 *
 *   engine.on('agentEvent', (e) => {
 *     if (e.eventType === 'text_delta') process.stdout.write(e.data.text)
 *   })
 *
 *   const { sessionKey } = await engine.sendMessage({ prompt: 'Hello!' })
 */

import { registerPlugin } from '@capacitor/core'
import type { MobileClawPlugin } from './definitions'

const MobileClaw = registerPlugin<MobileClawPlugin>('MobileClaw', {
  web: () => import('./plugin').then((m) => new m.MobileClawWeb()),
})

export * from './definitions'
export { MobileClaw }

export type { AgentRunnerConfig, AgentRunParams, PreExecuteResult } from './agent/agent-runner'
// WebView agent components — for consumers that need direct access
export { AgentRunner } from './agent/agent-runner'
export { ResourceQuotaTracker } from './agent/resource-quotas'
export { withRetry } from './agent/retry-logic'
export { SessionStore } from './agent/session-store'
export { ToolProxy } from './agent/tool-proxy'
export { TOOL_SCHEMAS } from './agent/tool-schemas'
// Export engine for direct use (framework wrappers, testing)
export { MobileClawEngine } from './engine'
export { McpServerManager } from './mcp/mcp-server-manager'

// DeviceTool interface — the contract for external tool packages
export type { DeviceTool } from './mcp/tools/types'
